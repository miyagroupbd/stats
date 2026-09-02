"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { cleanReplyBody, kindLabel } from "@/lib/replies";
import type { Reply, ThreadItem } from "@/lib/types";
import { formatDate } from "@/components/ui";

export function ReplyModal({ reply, onClose }: { reply: Reply; onClose: () => void }) {
  const [threadList, setThreadList] = useState<ThreadItem[]>([]);
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
    let initialThread: ThreadItem[] = [];
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
      const newMsg: ThreadItem = {
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

