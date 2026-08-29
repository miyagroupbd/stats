"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { confirmToast } from "@/lib/toast";
import type { Message, Paginated, Reply } from "@/lib/types";
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
const KINDS = ["initial", "followup_1", "followup_2", "followup_3"];

const KIND_LABELS: Record<string, string> = {
  initial: "Initial",
  followup_1: "Follow-up 1",
  followup_2: "Follow-up 2",
  followup_3: "Follow-up 3",
};

function kindLabel(kind: string) {
  return KIND_LABELS[kind] || kind;
}

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

export default function MessagesPage() {
  const { domains, loading: domainsLoading } = useDomains();

  const [view, setView] = useState<"outbox" | "replies">("outbox");
  const [domain, setDomain] = useState("");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [offset, setOffset] = useState(0);

  const [data, setData] = useState<Paginated<Message> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Message | null>(null);

  // Replies view state (own paging — the two lists are unrelated).
  const [replyOffset, setReplyOffset] = useState(0);
  const [replyData, setReplyData] = useState<Paginated<Reply> | null>(null);
  const [replyLoading, setReplyLoading] = useState(true);
  const [selectedReply, setSelectedReply] = useState<Reply | null>(null);
  const [backfilling, setBackfilling] = useState(false);

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

  const loadReplies = useCallback(() => {
    setReplyLoading(true);
    setError(null);
    const p = new URLSearchParams();
    if (domain) p.set("domain", domain);
    p.set("limit", String(LIMIT));
    p.set("offset", String(replyOffset));
    api
      .get<Paginated<Reply>>(`/messages/replies?${p.toString()}`)
      .then(setReplyData)
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : "Failed to load replies");
        setReplyData(null);
      })
      .finally(() => setReplyLoading(false));
  }, [domain, replyOffset]);

  useEffect(() => {
    if (view === "outbox") load();
  }, [load, view]);

  useEffect(() => {
    if (view === "replies") loadReplies();
  }, [loadReplies, view]);

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
            { domain: domain || null }
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

  // Reset paging whenever a filter changes.
  function onDomain(slug: string) {
    setDomain(slug);
    setOffset(0);
    setReplyOffset(0);
  }
  function onStatus(v: string) {
    setStatus(v);
    setOffset(0);
  }
  function onKind(v: string) {
    setKind(v);
    setOffset(0);
  }

  const isReplies = view === "replies";
  const items = data?.items ?? [];
  const replyItems = useMemo(() => {
    const raw = replyData?.items ?? [];
    const seen = new Set<number | string>();
    const deduped: Reply[] = [];
    for (const item of raw) {
      const key = item.lead_id ? item.lead_id : `id_${item.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(item);
      }
    }
    return deduped;
  }, [replyData?.items]);
  const total = (isReplies ? (replyData?.total ?? replyItems.length) : data?.total) ?? 0;
  const activeOffset = isReplies ? replyOffset : offset;
  const setActiveOffset = isReplies ? setReplyOffset : setOffset;
  const activeLoading = isReplies ? replyLoading : loading;
  // Fallback for the "Sent from" column before the backend is redeployed: when
  // a single arm is selected, every row is that arm, so use its from_email.
  const selectedFrom =
    domains.find((d) => d.slug === domain)?.from_email ?? null;
  const from = total === 0 ? 0 : activeOffset + 1;
  const to = Math.min(activeOffset + LIMIT, total);
  const hasPrev = activeOffset > 0;
  const hasNext = activeOffset + LIMIT < total;

  return (
    <div>
      <PageHeader
        title="Messages"
        subtitle={
          isReplies
            ? "Every reply received across the arms — see our sent message, the lead's pain point, and their accurate reply."
            : "Drafts auto-send 12 hours after creation. Edit, send early, or reject them here within that window — rejection is final."
        }
      />

      {/* View tabs */}
      <div className="mb-5 inline-flex rounded-lg border border-ink-800 bg-ink-900 p-1">
        {(
          [
            ["outbox", "Outbox"],
            ["replies", "Received / Got replies"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              view === v
                ? "bg-ink-800 text-ink-100"
                : "text-ink-400 hover:text-ink-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <Card className="mb-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="label mb-1.5">Domain</div>
            <DomainSelect includeAll value={domain} onChange={onDomain} />
          </div>

          {!isReplies && (
            <>
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
            </>
          )}

          <div className="ml-auto flex items-end gap-4">
            {total > 0 && (
              <span className="text-sm text-ink-400">
                <span className="text-ink-200 font-semibold">{total}</span>{" "}
                {isReplies
                  ? `repl${total === 1 ? "y" : "ies"}`
                  : `message${total === 1 ? "" : "s"}`}
              </span>
            )}
            {isReplies && (
              <button
                className="btn disabled:opacity-40"
                onClick={doBackfill}
                disabled={backfilling}
                title="Rescan the inbox and recover the text of old replies"
              >
                {backfilling ? "Queuing…" : "Backfill old replies"}
              </button>
            )}
          </div>
        </div>
      </Card>

      {error && (
        <div className="mb-4 rounded-lg border border-rose/40 bg-rose/10 px-4 py-3 text-sm text-rose">
          {error}
        </div>
      )}

      {/* Body — Replies view */}
      {isReplies && (
        <Card className="!p-0 overflow-hidden">
          {replyLoading || domainsLoading ? (
            <Spinner label="Loading replies…" />
          ) : replyItems.length === 0 ? (
            <EmptyState
              title="No replies recorded"
              hint="Replies are picked up by monitor runs. Use “Backfill old replies” to rescan the inbox for anything received earlier."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {[
                      "Lead",
                      "From",
                      "Company",
                      "Pain point",
                      "Our message",
                      "Their accurate reply",
                      "Received",
                    ].map((h) => (
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
                  {replyItems.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedReply(r)}
                      className="border-t border-ink-800 hover:bg-ink-850 cursor-pointer transition-colors"
                    >
                      <td className="py-2.5 px-3 text-ink-300 whitespace-nowrap font-mono">
                        #{r.lead_id}
                        {r.lead_name ? (
                          <span className="block text-xs font-sans text-ink-400 font-normal truncate max-w-[120px]">
                            {r.lead_name}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap font-mono text-xs text-ink-300 max-w-[180px] truncate">
                        {r.reply_from || r.lead_email || (
                          <span className="text-ink-500">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap text-ink-300 max-w-[140px] truncate">
                        {r.company || <span className="text-ink-500">—</span>}
                      </td>
                      <td className="py-2.5 px-3 max-w-[180px]">
                        {r.pain_point ? (
                          <span className="block truncate text-amber-300/90 text-xs bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 rounded">
                            {r.pain_point}
                          </span>
                        ) : (
                          <span className="text-ink-500 text-xs">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 max-w-[200px]">
                        {r.our_subject ? (
                          <div>
                            <span className="block truncate text-ink-200 font-medium">
                              {r.our_subject}
                            </span>
                            {r.our_kind && (
                              <span className="text-[11px] text-ink-400">
                                {kindLabel(r.our_kind)}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-ink-500">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 max-w-[260px]">
                        <span className="block truncate text-emerald-300 font-medium">
                          {r.reply_body || r.reply_subject || (
                            <span className="text-ink-400 italic">(no reply text)</span>
                          )}
                        </span>
                        {r.reply_subject && r.reply_body && (
                          <span className="block truncate text-[11px] text-ink-400">
                            Re: {r.reply_subject}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap text-ink-400">
                        {formatDate(r.received_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Body — Outbox view */}
      {!isReplies && (
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
      )}

      {/* Pagination (shared across views) */}
      {!activeLoading && (isReplies ? replyItems : items).length > 0 && (
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
              onClick={() => setActiveOffset(Math.max(0, activeOffset - LIMIT))}
              disabled={!hasPrev}
            >
              ← Prev
            </button>
            <button
              className="btn btn-ghost disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => setActiveOffset(activeOffset + LIMIT)}
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

      {selectedReply && (
        <ReplyModal reply={selectedReply} onClose={() => setSelectedReply(null)} />
      )}
    </div>
  );
}

function ReplyModal({ reply, onClose }: { reply: Reply; onClose: () => void }) {
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
        className="card-2 w-full max-w-3xl my-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-ink-800 p-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="badge text-emerald-400 border-emerald-400/40 bg-emerald-400/10 font-medium">
                Received Reply
              </span>
              <span className="text-xs text-ink-400">
                Lead #{reply.lead_id}
                {reply.lead_name ? ` · ${reply.lead_name}` : ""}
                {reply.company ? ` · ${reply.company}` : ""}
              </span>
            </div>
            <h2 className="text-lg font-semibold text-ink-100 break-words">
              {reply.reply_subject || (
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

        <div className="p-5 space-y-6">
          {/* Section 1: Lead Pain Point */}
          {reply.pain_point ? (
            <Field label="Lead Pain Point">
              <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm text-amber-200 whitespace-pre-wrap break-words font-medium">
                ⚡ {reply.pain_point}
              </div>
            </Field>
          ) : (
            <Field label="Lead Pain Point">
              <div className="text-xs text-ink-500 italic">No pain point recorded for this lead</div>
            </Field>
          )}

          {/* Section 2: Our Sent Email */}
          <Field
            label={`Our Sent Email${reply.our_kind ? ` · ${kindLabel(reply.our_kind)}` : ""}${
              reply.our_sent_at ? ` · sent ${formatDate(reply.our_sent_at)}` : ""
            }`}
          >
            <div className="rounded-lg border border-ink-800 bg-ink-950 p-4 max-h-[30vh] overflow-y-auto text-sm text-ink-300 whitespace-pre-wrap break-words leading-relaxed">
              {reply.our_subject && (
                <div className="font-semibold text-ink-200 mb-2 border-b border-ink-800/80 pb-2">
                  Subject: {reply.our_subject}
                </div>
              )}
              {reply.our_body || (
                <span className="text-ink-400 italic">(Our email body is unavailable)</span>
              )}
            </div>
          </Field>

          {/* Section 3: Their Accurate Reply */}
          <Field
            label={`Their Accurate Reply · received ${formatDate(reply.received_at)}`}
          >
            {reply.reply_body ? (
              <div className="rounded-lg border border-emerald-400/40 bg-emerald-950/20 p-4 max-h-[40vh] overflow-y-auto text-sm text-emerald-100 whitespace-pre-wrap break-words leading-relaxed shadow-inner">
                {reply.reply_subject && (
                  <div className="font-semibold text-emerald-300 mb-2 border-b border-emerald-400/20 pb-2">
                    Subject: {reply.reply_subject}
                  </div>
                )}
                {reply.reply_body}
              </div>
            ) : (
              <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm text-amber-300">
                Body not captured for this old reply — use “Backfill old replies” button above to recover it from the inbox.
              </div>
            )}
          </Field>

          {/* Metadata Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-ink-800">
            <Field label="From (Lead)">
              <span className="text-ink-300 text-sm font-mono break-all">
                {reply.reply_from || reply.lead_email || "—"}
              </span>
            </Field>
            <Field label="To (Our Arm)">
              <span className="text-ink-300 text-sm font-mono break-all">
                {reply.our_from || "—"}
              </span>
            </Field>
            <Field label="Company">
              <span className="text-ink-300 text-sm break-all">
                {reply.company || "—"}
              </span>
            </Field>
            <Field label="Received Timestamp">
              <span className="text-ink-300 text-sm break-all">
                {reply.reply_date || formatDate(reply.received_at)}
              </span>
            </Field>
          </div>
        </div>
      </div>
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
