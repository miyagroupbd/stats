"use client";

// The chat surface for one lead — header, pinned pain point, bubbles, AI
// prompt toolbar and the composer. Used inline by Messages → Chats.
// Escape-to-close and layout sizing belong to the caller; this component
// only fills whatever box it is given.

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  cleanReplyBody,
  dedupeThread,
  initialsOf,
  kindLabel,
  leadDisplayName,
  replySubjectFor,
  sourceLabel,
  threadKey,
} from "@/lib/replies";
import type { ConversationThread, ThreadItem } from "@/lib/types";
import { formatDate } from "@/components/ui";

type Intent = "book_meeting" | "answer_questions" | "pricing" | "short_friendly" | "custom";

const INTENTS: ReadonlyArray<readonly [Intent, string]> = [
  ["book_meeting", "📅 Book a Call"],
  ["answer_questions", "💡 Answer Questions"],
  ["pricing", "💰 Share Pricing"],
  ["short_friendly", "⚡ Short & Friendly"],
  ["custom", "✏️ Custom Prompt"],
];

interface SendReplyResponse {
  ok: boolean;
  message_id?: number;
  sent_at?: string;
  from?: string;
  to?: string;
}

export interface ConversationPaneProps {
  lead: ConversationThread["lead"];
  items: ThreadItem[];
  /** Called after a reply is accepted by the backend, with the item that was
   *  appended optimistically. Parents that own the thread should append it to
   *  their own state so the next `items` prop still contains it. */
  onSent?: (item: ThreadItem) => void;
  className?: string;
  /** Sending arm's from-address — shown in the header and used as the sender
   *  of the optimistic bubble when the backend does not echo one. */
  fromEmail?: string | null;
  /** Renders a close button in the header (modal use). */
  onClose?: () => void;
  /** Renders a back button in the header on small screens (two-pane mobile use). */
  onBack?: () => void;
}

export function ConversationPane({
  lead,
  items,
  onSent,
  className = "",
  fromEmail,
  onClose,
  onBack,
}: ConversationPaneProps) {
  const [threadList, setThreadList] = useState<ThreadItem[]>(() => dedupeThread(items));
  const [replyText, setReplyText] = useState("");
  const [replySubject, setReplySubject] = useState(() => replySubjectFor(items));
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [selectedIntent, setSelectedIntent] = useState<Intent>("book_meeting");
  const [showCustomPrompt, setShowCustomPrompt] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const chatRef = useRef<HTMLDivElement>(null);
  const firstScroll = useRef(true);

  // Re-sync when the parent hands us a new thread (poll, refetch, onSent echo).
  // Composer state is deliberately NOT reset here — remount with `key` to do that.
  useEffect(() => {
    setThreadList(dedupeThread(items));
  }, [items]);

  // Keep the newest bubble in view. Scroll the chat box itself, not the page.
  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: firstScroll.current ? "auto" : "smooth",
    });
    firstScroll.current = false;
  }, [threadList, isGenerating]);

  const leadName = leadDisplayName(
    [lead.first_name, lead.last_name].filter(Boolean).join(" "),
    lead.company,
    lead.email
  );
  const leadInitials = initialsOf(leadName);
  const shortName = lead.first_name?.trim() || leadName;

  // AI Reply Generator
  const handleGenerateAI = async (intent: Intent = selectedIntent) => {
    setIsGenerating(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await api.post<{ subject: string; body: string }>(
        `/messages/replies/${lead.id}/generate-reply`,
        {
          intent,
          custom_prompt: intent === "custom" ? customPrompt : undefined,
        }
      );
      setReplyText(res.body);
      if (res.subject) setReplySubject(res.subject);
      setActionSuccess("✨ AI drafted your reply! You can review, edit, or send below.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to generate AI reply.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Send Reply
  const handleSendReply = async () => {
    if (!replyText.trim() || isSending) return;
    setIsSending(true);
    setActionError(null);
    setActionSuccess(null);
    const subject = replySubject;
    const body = replyText;
    try {
      const res = await api.post<SendReplyResponse>(
        `/messages/replies/${lead.id}/send-reply`,
        { subject, body }
      );

      // Optimistically append the sent message; the backend records it as a
      // `followup_reply` message row, which the conversation feed maps to
      // source "board" with id "m:<message_id>".
      const newMsg: ThreadItem = {
        id: res?.message_id != null ? `m:${res.message_id}` : `local:${Date.now()}`,
        direction: "outbound",
        source: "board",
        sender: res?.from || fromEmail || "Miya Outreach",
        recipient: res?.to || lead.email || "",
        subject,
        body,
        kind: "followup_reply",
        timestamp: res?.sent_at || new Date().toISOString(),
        status: "sent",
      };
      setThreadList((prev) => dedupeThread([...prev, newMsg]));
      setReplyText("");
      setActionSuccess("🚀 Reply sent successfully via email!");
      onSent?.(newMsg);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to send email reply.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      className={`flex min-h-0 min-w-0 flex-col bg-[#0b141a] text-ink-100 ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-[#202c33] bg-[#111b21] px-3 py-3 sm:px-5 sm:py-3.5 shrink-0">
        <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0">
          {onBack && (
            <button
              type="button"
              className="md:hidden rounded-lg p-1.5 -ml-1 text-ink-300 hover:bg-[#202c33] hover:text-white transition-colors cursor-pointer text-lg leading-none shrink-0"
              onClick={onBack}
              aria-label="Back to conversations"
            >
              ←
            </button>
          )}

          {/* Avatar */}
          <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-white font-bold text-sm shadow-md">
            {leadInitials}
            <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-[#111b21]" />
          </div>

          {/* Contact Details */}
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-base font-bold text-white truncate">{leadName}</h2>
              {lead.company && leadName !== lead.company && (
                <span className="text-xs text-ink-400 font-medium truncate hidden sm:inline">
                  · {lead.company}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-ink-400 min-w-0">
              <span className="font-mono text-ink-300 truncate">{lead.email}</span>
              <span className="shrink-0">•</span>
              <span className="text-emerald-400 font-medium shrink-0">Lead #{lead.id}</span>
              {lead.status && (
                <>
                  <span className="shrink-0 hidden sm:inline">•</span>
                  <span className="shrink-0 hidden sm:inline capitalize">{lead.status}</span>
                </>
              )}
              {fromEmail && (
                <>
                  <span className="shrink-0 hidden lg:inline">•</span>
                  <span className="truncate max-w-[180px] text-ink-400 hidden lg:inline">
                    Arm: {fromEmail}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg border border-[#202c33] bg-[#202c33]/60 px-3 py-1.5 text-xs font-medium text-ink-300 hover:bg-[#202c33] transition-colors cursor-pointer disabled:opacity-50"
            onClick={() => handleGenerateAI("book_meeting")}
            disabled={isGenerating}
            title="Quick AI response"
          >
            ✨ <span className="hidden sm:inline">{isGenerating ? "Drafting..." : "AI Fast Reply"}</span>
          </button>
          {onClose && (
            <button
              type="button"
              className="rounded-lg p-2 text-ink-400 hover:bg-[#202c33] hover:text-white transition-colors cursor-pointer text-lg leading-none"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Pinned Lead Context / Pain Point Bar */}
      {lead.pain_point && (
        <div className="flex items-center justify-between gap-3 border-b border-amber-500/20 bg-amber-950/20 px-3 sm:px-5 py-2.5 shrink-0 text-xs">
          <div className="flex items-center gap-2 text-amber-200 min-w-0">
            <span className="text-amber-400 text-sm">⚡</span>
            <span className="font-semibold text-amber-300 shrink-0">Target Pain Point:</span>
            <span className="truncate font-medium" title={lead.pain_point}>
              {lead.pain_point}
            </span>
          </div>
          <button
            type="button"
            className="text-amber-400/80 hover:text-amber-300 text-[11px] underline shrink-0 cursor-pointer"
            onClick={() => {
              navigator.clipboard?.writeText(lead.pain_point || "");
              setActionSuccess("Copied pain point to clipboard!");
            }}
          >
            Copy
          </button>
        </div>
      )}

      {/* Notifications & Status Banner */}
      {actionSuccess && (
        <div className="bg-emerald-950/50 border-b border-emerald-500/30 px-3 sm:px-5 py-2 text-xs text-emerald-300 flex items-center justify-between shrink-0">
          <span>{actionSuccess}</span>
          <button
            type="button"
            onClick={() => setActionSuccess(null)}
            className="text-emerald-400 hover:text-emerald-200 ml-2"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
      {actionError && (
        <div className="bg-rose-950/50 border-b border-rose-500/30 px-3 sm:px-5 py-2 text-xs text-rose-300 flex items-center justify-between shrink-0">
          <span className="break-words min-w-0">⚠️ {actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-rose-400 hover:text-rose-200 ml-2 shrink-0"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Chat Area */}
      <div
        ref={chatRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3 sm:p-6 space-y-4 bg-[#0b141a]"
      >
        {threadList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-ink-400">
            <div className="text-3xl mb-2">💬</div>
            <p className="text-sm">No messages recorded yet for this lead.</p>
          </div>
        ) : (
          threadList.map((msg) => {
            const isOutbound = msg.direction === "outbound";
            const via = sourceLabel(msg.source);
            const failed = msg.status === "failed";
            const queued = msg.status === "queued";
            return (
              <div
                key={threadKey(msg)}
                className={`flex flex-col ${isOutbound ? "items-end" : "items-start"}`}
              >
                <div
                  className={`relative max-w-[85%] sm:max-w-[75%] min-w-0 rounded-2xl px-4 py-3 shadow-md ${
                    isOutbound
                      ? "bg-[#005c4b] text-[#e9edef] rounded-tr-xs"
                      : "bg-[#202c33] text-[#e9edef] rounded-tl-xs"
                  }`}
                >
                  {/* Message Meta / Tag */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5 text-[11px] opacity-85">
                    <span className="font-semibold">
                      {isOutbound ? "You (Miya Outreach)" : shortName}
                    </span>
                    {msg.kind && (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${
                          isOutbound
                            ? "bg-[#00483a] text-emerald-200"
                            : "bg-[#111b21] text-ink-300"
                        }`}
                      >
                        {isOutbound ? kindLabel(msg.kind) : "Reply"}
                      </span>
                    )}
                    {via && (
                      <span
                        className={`text-[10px] italic ${
                          isOutbound ? "text-emerald-200/80" : "text-ink-400"
                        }`}
                        title={
                          msg.source === "mailbox"
                            ? "Seen in the mailbox — not sent by the pipeline"
                            : "Sent from this board"
                        }
                      >
                        {via}
                      </span>
                    )}
                  </div>

                  {/* Subject line pill if present */}
                  {msg.subject && (
                    <div
                      className={`text-xs font-semibold px-2.5 py-1 rounded-md mb-2 break-words [overflow-wrap:anywhere] ${
                        isOutbound ? "bg-[#00483a]/70 text-emerald-100" : "bg-[#111b21]/80 text-ink-200"
                      }`}
                    >
                      Subject: {msg.subject}
                    </div>
                  )}

                  {/* Message Body */}
                  <div className="text-sm leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-normal">
                    {(isOutbound ? msg.body : cleanReplyBody(msg.body)) || (
                      <span className="italic opacity-60">
                        {isOutbound
                          ? "(Sent email body unavailable)"
                          : "(Reply text not captured — use “Backfill old replies”)"}
                      </span>
                    )}
                  </div>

                  {/* Timestamp & Status Indicator */}
                  <div className="mt-1.5 flex items-center justify-end gap-1.5 text-[10px] text-ink-400 select-none">
                    <span>{msg.timestamp ? formatDate(msg.timestamp) : ""}</span>
                    {isOutbound &&
                      (failed ? (
                        <span className="text-rose-400 font-bold text-xs" title="Send failed">
                          ✕ failed
                        </span>
                      ) : queued ? (
                        <span className="text-ink-400 font-bold text-xs" title="Queued to send">
                          ✓
                        </span>
                      ) : (
                        <span className="text-[#53bdeb] font-bold text-xs" title="Delivered via SMTP">
                          ✓✓
                        </span>
                      ))}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* AI Quick Prompts Toolbar */}
      <div className="border-t border-[#202c33] bg-[#111b21] px-3 sm:px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-semibold text-ink-400 uppercase tracking-wider mr-1">
            ✨ AI Prompts:
          </span>
          {INTENTS.map(([intent, label]) => (
            <button
              key={intent}
              type="button"
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
              className={`rounded-full px-3 py-1 text-xs font-medium transition-all cursor-pointer disabled:opacity-50 ${
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
          type="button"
          onClick={() => handleGenerateAI(selectedIntent)}
          disabled={isGenerating}
          className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:from-emerald-500 hover:to-teal-500 transition-all cursor-pointer disabled:opacity-50"
        >
          ✨ {isGenerating ? "Generating..." : "Generate AI Reply"}
        </button>
      </div>

      {/* Custom AI Instruction Bar (if toggled) */}
      {showCustomPrompt && (
        <div className="bg-[#182229] border-t border-[#202c33] px-3 sm:px-4 py-2 flex items-center gap-2 shrink-0">
          <input
            type="text"
            placeholder="E.g., Politely decline their discount request and propose a free trial instead..."
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            className="flex-1 min-w-0 bg-[#2a3942] rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-ink-400 outline-none border border-ink-700 focus:border-emerald-500"
            onKeyDown={(e) => {
              if (e.key === "Enter" && customPrompt.trim()) handleGenerateAI("custom");
            }}
          />
          <button
            type="button"
            onClick={() => handleGenerateAI("custom")}
            disabled={isGenerating || !customPrompt.trim()}
            className="btn btn-primary !py-1 !px-3 text-xs shrink-0 cursor-pointer disabled:opacity-50"
          >
            Generate
          </button>
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-[#202c33] bg-[#111b21] p-3 sm:p-4 shrink-0 space-y-2.5">
        {/* Subject Line Bar */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-ink-400 w-16 shrink-0">Subject:</span>
          <input
            type="text"
            value={replySubject}
            onChange={(e) => setReplySubject(e.target.value)}
            placeholder="Email subject..."
            className="flex-1 min-w-0 bg-[#202c33] rounded-lg px-3 py-1.5 text-xs text-ink-200 outline-none border border-[#2a3942] focus:border-emerald-500"
          />
        </div>

        {/* Message Textarea & Send Button */}
        <div className="flex items-end gap-3">
          <div className="flex-1 min-w-0 relative">
            <textarea
              rows={3}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder={`Type a reply to ${shortName} or click 'Generate AI Reply'...`}
              className="w-full bg-[#202c33] rounded-xl p-3 text-sm text-white placeholder:text-ink-400 outline-none border border-[#2a3942] focus:border-emerald-500 resize-none font-normal leading-relaxed"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleSendReply();
                }
              }}
            />
            <div className="absolute right-2 bottom-2 text-[10px] text-ink-400 pointer-events-none">
              Ctrl+Enter to send
            </div>
          </div>

          {/* Send Button */}
          <button
            type="button"
            onClick={handleSendReply}
            disabled={isSending || !replyText.trim()}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white hover:bg-[#00c298] transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer mb-0.5"
            title="Send reply via SMTP"
            aria-label="Send reply"
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
                aria-hidden="true"
              >
                <path d="M1.101 21.757L23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
