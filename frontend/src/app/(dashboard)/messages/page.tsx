"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export function cleanReplyBody(text?: string | null): string {
  if (!text) return "";
  const quoteHeaders = [
    /\n\s*On\s+[\s\S]{1,160}?\s+wrote:\s*\n/i,
    /\n\s*On\s+[\s\S]{1,160}?\s+wrote:\s*$/i,
    /\n\s*-+\s*Original Message\s*-+/i,
    /\n\s*_{10,}/,
    /\n\s*From:\s*.+\n\s*(?:Sent|Date):\s*.+/i,
    /\n\s*---+\s*On\s+.+\s+wrote:\s*---+/i,
    /\n\s*Begin forwarded message:/i,
    /\n\s*20\d\d[年/-].+?写道[：:]/,
  ];

  let clean = text;
  for (const pattern of quoteHeaders) {
    const parts = clean.split(pattern);
    if (parts.length > 1) {
      clean = parts[0];
      break;
    }
  }

  const lines = clean.split("\n");
  const filtered: string[] = [];
  for (const line of lines) {
    if (line.trim().startsWith(">")) {
      break;
    }
    filtered.push(line);
  }

  const result = filtered.join("\n").trim();
  return result || text.trim();
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
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
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
                          {cleanReplyBody(r.reply_body) || r.reply_subject || (
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
  const [threadList, setThreadList] = useState<import("@/lib/types").ThreadItem[]>([]);
  const [replyText, setReplyText] = useState("");
  const [replySubject, setReplySubject] = useState(
    reply.reply_subject?.toLowerCase().startsWith("re:")
      ? reply.reply_subject
      : `Re: ${reply.reply_subject || reply.our_subject || "Outreach"}`
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [selectedIntent, setSelectedIntent] = useState<"book_meeting" | "answer_questions" | "pricing" | "short_friendly" | "custom">("book_meeting");
  const [showCustomPrompt, setShowCustomPrompt] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Initialize and deduplicate thread messages
  useEffect(() => {
    let initialThread: import("@/lib/types").ThreadItem[] = [];
    if (reply.thread && reply.thread.length > 0) {
      const seen = new Set<string>();
      for (const msg of reply.thread) {
        const normBody = (msg.body || "").trim().slice(0, 80).toLowerCase().replace(/[^a-z0-9]/g, "");
        const normSubj = (msg.subject || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
        const key = `${msg.direction}_${normSubj}_${normBody}`;
        if (!seen.has(key)) {
          seen.add(key);
          initialThread.push(msg);
        }
      }
    } else {
      if (reply.our_body || reply.our_subject) {
        initialThread.push({
          direction: "outbound",
          sender: reply.our_from || "Miya Outreach",
          recipient: reply.lead_email || "",
          subject: reply.our_subject,
          body: reply.our_body,
          kind: reply.our_kind || "initial",
          timestamp: reply.our_sent_at,
          status: "sent",
        });
      }
      if (reply.reply_body || reply.reply_subject) {
        initialThread.push({
          direction: "inbound",
          sender: reply.reply_from || reply.lead_email || "",
          recipient: reply.our_from || "Miya Outreach",
          subject: reply.reply_subject,
          body: reply.reply_body,
          kind: "reply",
          timestamp: reply.received_at,
          status: "replied",
        });
      }
    }
    setThreadList(initialThread);
  }, [reply]);

  // Scroll to bottom whenever thread updates
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [threadList, isGenerating]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // AI Reply Generator
  const handleGenerateAI = async (intent: typeof selectedIntent = selectedIntent) => {
    setIsGenerating(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await api.post<{ subject: string; body: string }>(
        `/messages/replies/${reply.lead_id}/generate-reply`,
        {
          intent,
          custom_prompt: intent === "custom" ? customPrompt : undefined,
        }
      );
      setReplyText(res.body);
      if (res.subject) setReplySubject(res.subject);
      setActionSuccess("✨ AI drafted your reply! You can review, edit, or send below.");
    } catch (err: any) {
      setActionError(err.message || "Failed to generate AI reply.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Send Reply
  const handleSendReply = async () => {
    if (!replyText.trim()) return;
    setIsSending(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await api.post(`/messages/replies/${reply.lead_id}/send-reply`, {
        subject: replySubject,
        body: replyText,
      });

      // Optimistically append new sent message to the chat thread
      const newMsg: import("@/lib/types").ThreadItem = {
        direction: "outbound",
        sender: reply.our_from || "Miya Outreach",
        recipient: reply.lead_email || "",
        subject: replySubject,
        body: replyText,
        kind: "followup_reply",
        timestamp: new Date().toISOString(),
        status: "sent",
      };
      setThreadList((prev) => [...prev, newMsg]);
      setReplyText("");
      setActionSuccess("🚀 Reply sent successfully via email!");
    } catch (err: any) {
      setActionError(err.message || "Failed to send email reply.");
    } finally {
      setIsSending(false);
    }
  };

  const leadInitials = (reply.lead_name || reply.company || reply.lead_email || "Lead")
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 p-2 sm:p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[94vh] flex flex-col rounded-2xl border border-ink-800 bg-[#0b141a] text-ink-100 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* WhatsApp Chatbot Header */}
        <div className="flex items-center justify-between gap-3 border-b border-[#202c33] bg-[#111b21] px-5 py-3.5 shrink-0">
          <div className="flex items-center gap-3.5 min-w-0">
            {/* Avatar */}
            <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-white font-bold text-sm shadow-md">
              {leadInitials}
              <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-[#111b21]" />
            </div>

            {/* Contact Details */}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white truncate">
                  {reply.lead_name || reply.lead_email}
                </h2>
                {reply.company && (
                  <span className="text-xs text-ink-400 font-medium truncate">
                    · {reply.company}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-ink-400">
                <span className="font-mono text-ink-300">{reply.lead_email}</span>
                <span>•</span>
                <span className="text-emerald-400 font-medium">Lead #{reply.lead_id}</span>
                {reply.our_from && (
                  <>
                    <span>•</span>
                    <span className="truncate max-w-[180px] text-ink-400">Arm: {reply.our_from}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              className="flex items-center gap-1.5 rounded-lg border border-[#202c33] bg-[#202c33]/60 px-3 py-1.5 text-xs font-medium text-ink-300 hover:bg-[#202c33] transition-colors cursor-pointer"
              onClick={() => handleGenerateAI("book_meeting")}
              disabled={isGenerating}
              title="Quick AI response"
            >
              ✨ {isGenerating ? "Drafting..." : "AI Fast Reply"}
            </button>
            <button
              className="rounded-lg p-2 text-ink-400 hover:bg-[#202c33] hover:text-white transition-colors cursor-pointer text-lg leading-none"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Pinned Lead Context / Pain Point Bar */}
        {reply.pain_point && (
          <div className="flex items-center justify-between gap-3 border-b border-amber-500/20 bg-amber-950/20 px-5 py-2.5 shrink-0 text-xs">
            <div className="flex items-center gap-2 text-amber-200 min-w-0">
              <span className="text-amber-400 text-sm">⚡</span>
              <span className="font-semibold text-amber-300 shrink-0">Target Pain Point:</span>
              <span className="truncate font-medium">{reply.pain_point}</span>
            </div>
            <button
              className="text-amber-400/80 hover:text-amber-300 text-[11px] underline shrink-0 cursor-pointer"
              onClick={() => {
                navigator.clipboard.writeText(reply.pain_point || "");
                setActionSuccess("Copied pain point to clipboard!");
              }}
            >
              Copy
            </button>
          </div>
        )}

        {/* Notifications & Status Banner */}
        {actionSuccess && (
          <div className="bg-emerald-950/50 border-b border-emerald-500/30 px-5 py-2 text-xs text-emerald-300 flex items-center justify-between">
            <span>{actionSuccess}</span>
            <button onClick={() => setActionSuccess(null)} className="text-emerald-400 hover:text-emerald-200 ml-2">✕</button>
          </div>
        )}
        {actionError && (
          <div className="bg-rose-950/50 border-b border-rose-500/30 px-5 py-2 text-xs text-rose-300 flex items-center justify-between">
            <span>⚠️ {actionError}</span>
            <button onClick={() => setActionError(null)} className="text-rose-400 hover:text-rose-200 ml-2">✕</button>
          </div>
        )}

        {/* WhatsApp Chat Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-[#0b141a] min-h-[320px] max-h-[50vh]">
          {threadList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center text-ink-500">
              <div className="text-3xl mb-2">💬</div>
              <p className="text-sm">No messages recorded yet for this lead.</p>
            </div>
          ) : (
            threadList.map((msg, idx) => {
              const isOutbound = msg.direction === "outbound";
              return (
                <div
                  key={idx}
                  className={`flex flex-col ${isOutbound ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`relative max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 shadow-md ${
                      isOutbound
                        ? "bg-[#005c4b] text-[#e9edef] rounded-tr-xs"
                        : "bg-[#202c33] text-[#e9edef] rounded-tl-xs"
                    }`}
                  >
                    {/* Message Meta / Tag */}
                    <div className="flex items-center gap-2 mb-1.5 text-[11px] opacity-85">
                      <span className="font-semibold">
                        {isOutbound ? "You (Miya Outreach)" : reply.lead_name || "Lead"}
                      </span>
                      {msg.kind && (
                        <span
                          className={`px-1.5 py-0.2 rounded text-[10px] uppercase font-bold tracking-wider ${
                            isOutbound
                              ? "bg-[#00483a] text-emerald-200"
                              : "bg-[#111b21] text-ink-300"
                          }`}
                        >
                          {isOutbound ? kindLabel(msg.kind) : "Reply"}
                        </span>
                      )}
                    </div>

                    {/* Subject line pill if present */}
                    {msg.subject && (
                      <div
                        className={`text-xs font-semibold px-2.5 py-1 rounded-md mb-2 ${
                          isOutbound ? "bg-[#00483a]/70 text-emerald-100" : "bg-[#111b21]/80 text-ink-200"
                        }`}
                      >
                        Subject: {msg.subject}
                      </div>
                    )}

                    {/* Message Body */}
                    <div className="text-sm leading-relaxed whitespace-pre-wrap break-words font-normal">
                      {(isOutbound ? msg.body : cleanReplyBody(msg.body)) || (
                        <span className="italic opacity-60">
                          {isOutbound
                            ? "(Sent email body unavailable)"
                            : "(Reply text not captured — click 'Backfill old replies' above)"}
                        </span>
                      )}
                    </div>

                    {/* Timestamp & Status Indicator */}
                    <div className="mt-1.5 flex items-center justify-end gap-1.5 text-[10px] text-ink-400 select-none">
                      <span>{msg.timestamp ? formatDate(msg.timestamp) : ""}</span>
                      {isOutbound && (
                        <span className="text-[#53bdeb] font-bold text-xs" title="Delivered via SMTP">
                          ✓✓
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={chatEndRef} />
        </div>

        {/* AI Quick Prompts Toolbar */}
        <div className="border-t border-[#202c33] bg-[#111b21] px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-ink-400 uppercase tracking-wider mr-1">
              ✨ AI Prompts:
            </span>
            {(
              [
                ["book_meeting", "📅 Book a Call"],
                ["answer_questions", "💡 Answer Questions"],
                ["pricing", "💰 Share Pricing"],
                ["short_friendly", "⚡ Short & Friendly"],
                ["custom", "✏️ Custom Prompt"],
              ] as const
            ).map(([intent, label]) => (
              <button
                key={intent}
                onClick={() => {
                  setSelectedIntent(intent);
                  if (intent === "custom") {
                    setShowCustomPrompt(true);
                  } else {
                    setShowCustomPrompt(false);
                    handleGenerateAI(intent);
                  }
                }}
                disabled={isGenerating}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-all cursor-pointer ${
                  selectedIntent === intent
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                    : "bg-[#202c33] text-ink-300 hover:bg-[#2a3942] hover:text-white border border-transparent"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            onClick={() => handleGenerateAI(selectedIntent)}
            disabled={isGenerating}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:from-emerald-500 hover:to-teal-500 transition-all cursor-pointer disabled:opacity-50"
          >
            ✨ {isGenerating ? "Generating..." : "Generate AI Reply"}
          </button>
        </div>

        {/* Custom AI Instruction Bar (if toggled) */}
        {showCustomPrompt && (
          <div className="bg-[#182229] border-t border-[#202c33] px-4 py-2 flex items-center gap-2 shrink-0">
            <input
              type="text"
              placeholder="E.g., Politely decline their discount request and propose a free trial instead..."
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              className="flex-1 bg-[#2a3942] rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-ink-400 outline-none border border-ink-700 focus:border-emerald-500"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleGenerateAI("custom");
              }}
            />
            <button
              onClick={() => handleGenerateAI("custom")}
              disabled={isGenerating || !customPrompt.trim()}
              className="btn btn-primary !py-1 !px-3 text-xs shrink-0 cursor-pointer"
            >
              Generate
            </button>
          </div>
        )}

        {/* WhatsApp Chat Input & Send Bar */}
        <div className="border-t border-[#202c33] bg-[#111b21] p-4 shrink-0 space-y-2.5">
          {/* Subject Line Bar */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-ink-400 w-16 shrink-0">Subject:</span>
            <input
              type="text"
              value={replySubject}
              onChange={(e) => setReplySubject(e.target.value)}
              placeholder="Email subject..."
              className="flex-1 bg-[#202c33] rounded-lg px-3 py-1.5 text-xs text-ink-200 outline-none border border-[#2a3942] focus:border-emerald-500"
            />
          </div>

          {/* Message Textarea & Send Button */}
          <div className="flex items-end gap-3">
            <div className="flex-1 relative">
              <textarea
                rows={3}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder={`Type a reply to ${reply.lead_name || "the lead"} or click 'Generate AI Reply'...`}
                className="w-full bg-[#202c33] rounded-xl p-3 text-sm text-white placeholder:text-ink-500 outline-none border border-[#2a3942] focus:border-emerald-500 resize-none font-normal leading-relaxed"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleSendReply();
                  }
                }}
              />
              <div className="absolute right-2 bottom-2 text-[10px] text-ink-500 pointer-events-none">
                Ctrl+Enter to send
              </div>
            </div>

            {/* WhatsApp Green Send Button */}
            <button
              onClick={handleSendReply}
              disabled={isSending || !replyText.trim()}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white hover:bg-[#00c298] transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer mb-0.5"
              title="Send reply via SMTP"
            >
              {isSending ? (
                <span className="animate-spin text-sm">⏳</span>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  fill="currentColor"
                  className="translate-x-0.5"
                >
                  <path d="M1.101 21.757L23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z" />
                </svg>
              )}
            </button>
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
