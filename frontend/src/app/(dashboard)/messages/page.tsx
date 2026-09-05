"use client";

// Messages: two tabs.
//   Chats  — WhatsApp-style two-pane view over GET /conversations (every lead
//            with real correspondence) and GET /conversations/{lead_id}.
//            Selected lead lives in the URL as ?lead=<id>.
//   Outbox — the drafts table + MessageModal approval gate, unchanged.
// The old "Received replies" table and the /replies page are superseded by
// Chats (MGB-429).

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { confirmToast } from "@/lib/toast";
import type {
  ConversationThread,
  Domain,
  Message,
  Paginated,
  ThreadItem,
} from "@/lib/types";
import { kindLabel } from "@/lib/replies";
import { ConversationList } from "@/components/ConversationList";
import { ConversationPane } from "@/components/ConversationPane";
import { useDomains } from "@/lib/hooks";
import { DomainSelect } from "@/components/DomainSelect";
import {
  Card,
  PageHeader,
  StatusBadge,
  Spinner,
  EmptyState,
  formatDate,
} from "@/components/ui";

const LIMIT = 25;
const STATUSES = ["drafted", "approved", "rejected", "queued", "sent", "failed"];
const KINDS = ["initial", "followup_1", "followup_2", "followup_3", "followup_reply"];

type Tab = "chats" | "outbox";

function buildQuery(
  domain: string,
  status: string,
  kind: string,
  offset: number
) {
  const p = new URLSearchParams();
  if (domain) p.set("domain", domain);
  if (status) p.set("status", status);
  if (kind) p.set("kind", kind);
  p.set("limit", String(LIMIT));
  p.set("offset", String(offset));
  return p.toString();
}

// useSearchParams needs a Suspense boundary or the static build bails out.
export default function MessagesPage() {
  return (
    <Suspense fallback={<Spinner label="Loading messages…" />}>
      <MessagesPageInner />
    </Suspense>
  );
}

function MessagesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { domains } = useDomains();

  const tab: Tab = searchParams.get("tab") === "outbox" ? "outbox" : "chats";
  const leadParam = searchParams.get("lead");
  const leadId = leadParam && /^\d+$/.test(leadParam) ? Number(leadParam) : null;

  const setParams = useCallback(
    (next: { tab?: Tab; lead?: number | null }) => {
      const p = new URLSearchParams(searchParams.toString());
      if (next.tab !== undefined) {
        if (next.tab === "chats") p.delete("tab");
        else p.set("tab", next.tab);
      }
      if (next.lead !== undefined) {
        if (next.lead === null) p.delete("lead");
        else p.set("lead", String(next.lead));
      }
      const qs = p.toString();
      router.replace(qs ? `/messages?${qs}` : "/messages", { scroll: false });
    },
    [router, searchParams]
  );

  const [backfilling, setBackfilling] = useState(false);

  function doBackfill() {
    confirmToast({
      title: "Recover old replies?",
      description:
        "Queues an inbox rescan per arm — attaches the full text to replies received before capture existed. Safe to re-run.",
      confirmLabel: "Backfill",
      onConfirm: async () => {
        setBackfilling(true);
        try {
          const r = await api.post<{ queued: Record<string, number> }>(
            "/messages/replies/backfill",
            { domain: null }
          );
          const n = Object.keys(r.queued).length;
          toast.success(
            `Backfill queued — ${n} run${n === 1 ? "" : "s"} (see Runs page). Refresh in a minute.`
          );
        } catch (e) {
          toast.error(
            e instanceof ApiError ? e.message : "Failed to queue backfill"
          );
        } finally {
          setBackfilling(false);
        }
      },
    });
  }

  const isChats = tab === "chats";

  return (
    <div
      className={
        isChats
          ? "flex flex-col h-[calc(100vh-4rem)] min-h-[520px] min-w-0"
          : "min-w-0"
      }
    >
      <PageHeader
        title="Messages"
        subtitle={
          isChats
            ? "Every conversation with a lead — what we sent, what they wrote back, and anything sent by hand from the mailbox. Pick one to read the thread and answer it."
            : "Drafts auto-send 12 hours after creation. Edit, send early, or reject them here within that window — rejection is final."
        }
        actions={
          isChats ? (
            <button
              type="button"
              className="btn btn-ghost text-sm disabled:opacity-40"
              onClick={doBackfill}
              disabled={backfilling}
              title="Rescan the inbox and recover the text of old replies"
            >
              {backfilling ? "Queuing…" : "Backfill old replies"}
            </button>
          ) : undefined
        }
      />

      {/* View tabs */}
      <div className="mb-5 inline-flex self-start rounded-lg border border-ink-800 bg-ink-900 p-1 shrink-0">
        {(
          [
            ["chats", "Chats"],
            ["outbox", "Outbox"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => setParams({ tab: v })}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
              tab === v
                ? "bg-ink-800 text-ink-100"
                : "text-ink-400 hover:text-ink-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {isChats ? (
        <ChatsView
          leadId={leadId}
          domains={domains}
          onSelectLead={(id) => setParams({ lead: id })}
        />
      ) : (
        <OutboxView domains={domains} />
      )}
    </div>
  );
}

// ── Chats ───────────────────────────────────────────────────────────────────

function ChatsView({
  leadId,
  domains,
  onSelectLead,
}: {
  leadId: number | null;
  domains: Domain[];
  onSelectLead: (id: number | null) => void;
}) {
  const [thread, setThread] = useState<ConversationThread | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [listRefresh, setListRefresh] = useState(0);

  useEffect(() => {
    if (leadId === null) {
      setThread(null);
      setThreadError(null);
      setThreadLoading(false);
      return;
    }
    let active = true;
    setThreadLoading(true);
    setThreadError(null);
    api
      .get<ConversationThread>(`/conversations/${leadId}`)
      .then((t) => {
        if (active) setThread(t);
      })
      .catch((e) => {
        if (!active) return;
        setThreadError(
          e instanceof ApiError ? e.message : "Failed to load conversation"
        );
        setThread(null);
      })
      .finally(() => {
        if (active) setThreadLoading(false);
      });
    return () => {
      active = false;
    };
  }, [leadId]);

  // Keep the sent bubble in the parent-owned thread so the pane's items
  // re-sync still contains it, and nudge the list so last_preview updates.
  const handleSent = useCallback((item: ThreadItem) => {
    setThread((prev) => (prev ? { ...prev, items: [...prev.items, item] } : prev));
    setListRefresh((n) => n + 1);
  }, []);

  const ready = thread !== null && thread.lead.id === leadId && !threadLoading;
  const fromEmail = ready
    ? (domains.find((d) => d.id === thread.lead.domain_id)?.from_email ?? null)
    : null;
  const hasLead = leadId !== null;

  return (
    <div className="flex-1 min-h-0 min-w-0 flex overflow-hidden rounded-2xl border border-[#202c33] bg-[#0b141a]">
      <ConversationList
        className={`${hasLead ? "hidden md:flex" : "flex"} w-full md:w-80 lg:w-96 shrink-0 md:border-r md:border-[#202c33]`}
        selectedLeadId={leadId}
        onSelect={(c) => onSelectLead(c.lead_id)}
        refreshKey={listRefresh}
      />

      <section
        className={`${hasLead ? "flex" : "hidden md:flex"} flex-1 min-w-0 min-h-0 flex-col`}
      >
        {!hasLead ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center text-ink-400 p-8">
            <div className="text-4xl mb-3">💬</div>
            <p className="text-sm font-medium text-ink-300">Pick a conversation</p>
            <p className="text-xs mt-1 max-w-xs">
              The thread, the lead&apos;s pain point and an AI-assisted composer open here.
            </p>
          </div>
        ) : ready ? (
          <ConversationPane
            key={thread.lead.id}
            lead={thread.lead}
            items={thread.items}
            onSent={handleSent}
            fromEmail={fromEmail}
            onBack={() => onSelectLead(null)}
            className="h-full"
          />
        ) : threadError ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center p-8 gap-3">
            <p className="text-sm text-rose-300 break-words">{threadError}</p>
            <button
              type="button"
              className="btn btn-ghost text-sm"
              onClick={() => onSelectLead(null)}
            >
              Back to conversations
            </button>
          </div>
        ) : (
          <Spinner label="Loading conversation…" />
        )}
      </section>
    </div>
  );
}

// ── Outbox ──────────────────────────────────────────────────────────────────

function OutboxView({ domains }: { domains: Domain[] }) {
  const { loading: domainsLoading } = useDomains();

  const [domain, setDomain] = useState("");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [offset, setOffset] = useState(0);

  const [data, setData] = useState<Paginated<Message> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Message | null>(null);

  // Default to "All domains" (empty slug). Seeding the first active arm meant
  // the page opened on whichever arm sorted first (consultant, which has no
  // messages) — so drafts on other arms were invisible.

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .get<Paginated<Message>>(
        `/messages/?${buildQuery(domain, status, kind, offset)}`
      )
      .then(setData)
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : "Failed to load messages");
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [domain, status, kind, offset]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset paging whenever a filter changes.
  function onDomain(slug: string) {
    setDomain(slug);
    setOffset(0);
  }
  function onStatus(v: string) {
    setStatus(v);
    setOffset(0);
  }
  function onKind(v: string) {
    setKind(v);
    setOffset(0);
  }

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  // Fallback for the "Sent from" column before the backend is redeployed: when
  // a single arm is selected, every row is that arm, so use its from_email.
  const selectedFrom =
    domains.find((d) => d.slug === domain)?.from_email ?? null;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + LIMIT, total);
  const hasPrev = offset > 0;
  const hasNext = offset + LIMIT < total;

  return (
    <div>
      {/* Toolbar */}
      <Card className="mb-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="label mb-1.5">Domain</div>
            <DomainSelect includeAll value={domain} onChange={onDomain} />
          </div>

          <div>
            <div className="label mb-1.5">Status</div>
            <select
              className="input max-w-[180px]"
              value={status}
              onChange={(e) => onStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="label mb-1.5">Kind</div>
            <select
              className="input max-w-[180px]"
              value={kind}
              onChange={(e) => onKind(e.target.value)}
            >
              <option value="">All kinds</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          </div>

          <div className="ml-auto flex items-end gap-4">
            {total > 0 && (
              <span className="text-sm text-ink-400">
                <span className="text-ink-200 font-semibold">{total}</span>{" "}
                {`message${total === 1 ? "" : "s"}`}
              </span>
            )}
          </div>
        </div>
      </Card>

      {error && (
        <div className="mb-4 rounded-lg border border-rose/40 bg-rose/10 px-4 py-3 text-sm text-rose">
          {error}
        </div>
      )}

      <Card className="!p-0 overflow-hidden">
        {loading || domainsLoading ? (
          <Spinner label="Loading messages…" />
        ) : items.length === 0 ? (
          <EmptyState
            title="No messages found"
            hint="Try clearing the status or kind filters, or run discovery to draft new emails."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {["Lead", "Sent to", "Kind", "Subject", "Sent from", "Status", "Bounced", "Sent"].map((h) => (
                    <th
                      key={h}
                      className="text-left text-xs uppercase tracking-wide text-ink-400 font-semibold py-2 px-3"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <tr
                    key={m.id}
                    onClick={() => setSelected(m)}
                    className="border-t border-ink-800 hover:bg-ink-850 cursor-pointer"
                  >
                    <td className="py-2.5 px-3 text-ink-300 whitespace-nowrap font-mono">
                      #{m.lead_id}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap font-mono text-xs text-ink-300">
                      {m.to_email || <span className="text-ink-500">—</span>}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span className="text-ink-300">{kindLabel(m.kind)}</span>
                    </td>
                    <td className="py-2.5 px-3 max-w-[420px]">
                      <span className="block truncate text-ink-100">
                        {m.subject || (
                          <span className="text-ink-400 italic">
                            (no subject)
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap font-mono text-xs text-ink-300">
                      {m.from_email || (domain ? selectedFrom : null) || (
                        <span className="text-ink-500">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <StatusBadge value={m.status} />
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {m.bounced ? (
                        <span className="badge text-rose border-rose/40 bg-rose/10">
                          Bounced
                        </span>
                      ) : (
                        <span className="text-ink-500">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-ink-400">
                      {formatDate(m.sent_at || m.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Pagination */}
      {!loading && items.length > 0 && (
        <div className="flex items-center justify-between gap-4 mt-4">
          <div className="text-xs text-ink-400">
            Showing{" "}
            <span className="text-ink-300 font-medium">
              {from}–{to}
            </span>{" "}
            of <span className="text-ink-300 font-medium">{total}</span>
          </div>
          <div className="flex gap-2">
            <button
              className="btn btn-ghost disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              disabled={!hasPrev}
            >
              ← Prev
            </button>
            <button
              className="btn btn-ghost disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => setOffset(offset + LIMIT)}
              disabled={!hasNext}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {selected && (
        <MessageModal
          message={selected}
          onClose={() => setSelected(null)}
          onChanged={(updated) => {
            if (updated) setSelected(updated);
            load();
          }}
        />
      )}
    </div>
  );
}

function MessageModal({
  message,
  onClose,
  onChanged,
}: {
  message: Message;
  onClose: () => void;
  onChanged: (updated?: Message) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editSubject, setEditSubject] = useState(message.subject || "");
  const [editSubjectB, setEditSubjectB] = useState(message.subject_b || "");
  const [editBody, setEditBody] = useState(message.body || "");

  const canApprove = ["drafted", "rejected", "failed"].includes(message.status);
  const canReject = message.status !== "sent" && message.status !== "rejected";
  const canSend = message.status !== "sent";
  const canEdit = !["queued", "sent"].includes(message.status);

  function startEdit() {
    setEditSubject(message.subject || "");
    setEditSubjectB(message.subject_b || "");
    setEditBody(message.body || "");
    setEditing(true);
  }

  async function run(
    label: string,
    fn: () => Promise<unknown>,
    after?: (r: unknown) => void,
    successMsg?: string
  ) {
    setBusy(label);
    try {
      const r = await fn();
      if (successMsg) toast.success(successMsg);
      after?.(r);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : `Failed to ${label}`);
    } finally {
      setBusy(null);
    }
  }

  const doSaveEdit = () =>
    run(
      "save",
      () =>
        api.patch<Message>(`/messages/${message.id}`, {
          subject: editSubject,
          subject_b: editSubjectB,
          body: editBody,
        }),
      (r) => {
        setEditing(false);
        onChanged(r as Message);
      },
      message.status === "approved"
        ? "Draft updated — approval was reset, please re-approve."
        : "Draft updated."
    );

  const doApprove = () =>
    run(
      "approve",
      () => api.post<Message>(`/messages/${message.id}/approve`),
      (r) => onChanged(r as Message),
      "Draft approved — cleared to send."
    );

  const doReject = () =>
    run(
      "reject",
      () => api.post<Message>(`/messages/${message.id}/reject`),
      () => {
        onChanged();
        onClose();
      },
      "Draft rejected."
    );

  const doSend = () =>
    confirmToast({
      title: "Send this email now?",
      description:
        "It goes out to the real recipient via N8N and cannot be unsent.",
      confirmLabel: "Send",
      onConfirm: () =>
        run(
          "send",
          () => api.post<{ send_run_id: number }>(`/messages/${message.id}/send`),
          (r) => {
            const id = (r as { send_run_id: number }).send_run_id;
            toast.success(`Sending — queued run #${id}.`);
            onChanged();
            onClose();
          }
        ),
    });

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="card-2 w-full max-w-2xl my-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-ink-800 p-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <StatusBadge value={message.status} />
              <span className="text-xs text-ink-400">
                {kindLabel(message.kind)} · Lead #{message.lead_id}
              </span>
            </div>
            <h2 className="text-lg font-semibold text-ink-100 break-words">
              {message.subject || (
                <span className="text-ink-400 italic">(no subject)</span>
              )}
            </h2>
          </div>
          <button
            className="btn btn-ghost shrink-0 !px-3"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {editing ? (
            <>
              <Field label="Subject">
                <input
                  className="input w-full"
                  value={editSubject}
                  onChange={(e) => setEditSubject(e.target.value)}
                  placeholder="Subject line"
                />
              </Field>
              <Field label="Subject B (variant, optional)">
                <input
                  className="input w-full"
                  value={editSubjectB}
                  onChange={(e) => setEditSubjectB(e.target.value)}
                  placeholder="A/B variant subject"
                />
              </Field>
              <Field label="Body">
                <textarea
                  className="input w-full min-h-[40vh] font-mono text-sm leading-relaxed"
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                />
              </Field>
              <div className="flex items-center gap-2">
                <button
                  className="btn btn-primary disabled:opacity-40"
                  onClick={doSaveEdit}
                  disabled={busy !== null || !editSubject.trim() || !editBody.trim()}
                >
                  {busy === "save" ? "Saving…" : "Save changes"}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => setEditing(false)}
                  disabled={busy !== null}
                >
                  Cancel
                </button>
                {message.status === "approved" && (
                  <span className="text-xs text-amber-400">
                    Saving resets approval — you approve exactly what gets sent.
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
              {message.subject_b && (
                <Field label="Subject B (variant)">
                  <span className="text-ink-100">{message.subject_b}</span>
                </Field>
              )}

              <Field label="Body">
                {message.body ? (
                  <div className="rounded-lg border border-ink-800 bg-ink-950 p-4 max-h-[45vh] overflow-y-auto text-sm text-ink-200 whitespace-pre-wrap break-words leading-relaxed">
                    {message.body}
                  </div>
                ) : (
                  <span className="text-ink-400 italic text-sm">(empty body)</span>
                )}
              </Field>
            </>
          )}

          {message.error && (
            <Field label="Error">
              <div className="rounded-lg border border-rose/40 bg-rose/10 px-3 py-2 text-sm text-rose whitespace-pre-wrap break-words">
                {message.error}
              </div>
            </Field>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <Field label="Sent to">
              <span className="text-ink-300 text-sm font-mono break-all">
                {message.to_email || "—"}
                {message.bounced && (
                  <span className="ml-2 badge text-rose border-rose/40 bg-rose/10">
                    Bounced
                  </span>
                )}
              </span>
            </Field>
            <Field label="Sent">
              <span className="text-ink-300 text-sm">
                {message.sent_at ? formatDate(message.sent_at) : "—"}
              </span>
            </Field>
            <Field label="Created">
              <span className="text-ink-300 text-sm">
                {formatDate(message.created_at)}
              </span>
            </Field>
            <Field label="SMTP Message ID">
              <span className="text-ink-300 text-sm font-mono break-all">
                {message.smtp_message_id || "—"}
              </span>
            </Field>
            <Field label="Campaign">
              <span className="text-ink-300 text-sm">
                {message.campaign_id != null ? `#${message.campaign_id}` : "—"}
              </span>
            </Field>
            <Field label="Approved">
              <span className="text-ink-300 text-sm">
                {message.approved_at
                  ? `${formatDate(message.approved_at)}${
                      message.approved_by ? ` · ${message.approved_by}` : ""
                    }`
                  : "—"}
              </span>
            </Field>
          </div>
        </div>

        {/* Approval action bar — the human gate. Nothing sends without this. */}
        <div className="border-t border-ink-800 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={doApprove}
              disabled={!canApprove || busy !== null || editing}
            >
              {busy === "approve" ? "Approving…" : "Approve"}
            </button>
            <button
              className="btn disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={startEdit}
              disabled={!canEdit || busy !== null || editing}
              title="Edit the subject/body before approving"
            >
              Edit
            </button>
            <button
              className="btn disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={doSend}
              disabled={!canSend || busy !== null}
              title="Approve (if needed) and send this one email now, via N8N"
            >
              {busy === "send" ? "Sending…" : "Send now"}
            </button>
            <button
              className="btn btn-ghost text-rose disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={doReject}
              disabled={!canReject || busy !== null}
            >
              {busy === "reject" ? "Rejecting…" : "Reject"}
            </button>
            <span className="ml-auto text-xs text-ink-400">
              Drafts auto-send ~12h after creation — reject or edit within the
              window to stop or change one.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="label mb-1.5">{label}</div>
      {children}
    </div>
  );
}
