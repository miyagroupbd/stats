"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { confirmToast } from "@/lib/toast";
import type { Message, Paginated } from "@/lib/types";
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

  const total = data?.total ?? 0;
  const items = data?.items ?? [];
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
      <PageHeader
        title="Messages"
        subtitle="Review drafts and approve, reject, or send them. Nothing goes out until you approve it here."
      />

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

          <div className="ml-auto text-sm text-ink-400">
            {total > 0 && (
              <span>
                <span className="text-ink-200 font-semibold">{total}</span>{" "}
                message{total === 1 ? "" : "s"}
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

      {/* Body */}
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

  const canApprove = ["drafted", "rejected", "failed"].includes(message.status);
  const canReject = message.status !== "sent" && message.status !== "rejected";
  const canSend = message.status !== "sent";

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
      (r) => onChanged(r as Message),
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
            toast.success(`Sending — queued run #${id} (delivers via N8N).`);
            onChanged();
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
              disabled={!canApprove || busy !== null}
            >
              {busy === "approve" ? "Approving…" : "Approve"}
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
              Sending goes out from the brand address via N8N — never unattended.
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
