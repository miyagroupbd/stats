// Shared reply helpers, used by the Messages outbox and the Replies board.
// Lifted out of the messages page when Replies became its own route so both
// surfaces strip quoted history identically — a reply that reads clean in one
// place and bloated in the other is worse than either alone.

export const KIND_LABELS: Record<string, string> = {
  initial: "Initial",
  followup_1: "Follow-up 1",
  followup_2: "Follow-up 2",
  followup_3: "Follow-up 3",
  followup_reply: "Reply", // sent by a person from the chat view
};

export function kindLabel(kind: string) {
  return KIND_LABELS[kind] || kind;
}

/** Strip quoted thread history so only the sender's new text shows. */
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

// ── Conversation (chat view) helpers ─────────────────────────────────────────
// Shared by ConversationList and ConversationPane so a lead is named,
// initialled and timed identically in the list and the thread.

import type { ThreadItem } from "./types";

/** Name → company → email → "Lead". */
export function leadDisplayName(
  name?: string | null,
  company?: string | null,
  email?: string | null
): string {
  return name?.trim() || company?.trim() || email?.trim() || "Lead";
}

/** Two-letter avatar initials; an email address uses its local part. */
export function initialsOf(label: string): string {
  const base = label.replace(/@.*$/, "");
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const chars = parts.slice(0, 2).map((w) => w[0]);
  const out = chars.join("") || base.slice(0, 2) || "?";
  return out.toUpperCase();
}

/** Compact relative time for list rows: now · 5m · 3h · Yesterday · 4d · Sep 3. */
export function relativeTime(iso?: string | null, now: number = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diffMin = Math.floor(Math.max(0, now - t) / 60_000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Small "via …" label for items that did not come from the pipeline send path. */
export function sourceLabel(source?: string | null): string | null {
  if (source === "mailbox") return "via mailbox";
  if (source === "board") return "via board";
  return null;
}

/** Stable-ish identity for a thread item: backend id when present, else a
 *  fuzzy direction+subject+body key (legacy rows without ids). */
export function threadKey(item: ThreadItem): string {
  if (item.id) return item.id;
  const normBody = (item.body || "")
    .trim()
    .slice(0, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const normSubj = (item.subject || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${item.direction}_${normSubj}_${normBody}`;
}

/** Drop duplicate items, keeping first occurrence and original order. */
export function dedupeThread(items: ThreadItem[]): ThreadItem[] {
  const seen = new Set<string>();
  const out: ThreadItem[] = [];
  for (const item of items) {
    const key = threadKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Default composer subject: latest inbound subject, else latest outbound,
 *  else "Outreach" — always prefixed with "Re:". */
export function replySubjectFor(items: ThreadItem[]): string {
  let inbound: string | null = null;
  let outbound: string | null = null;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (!it.subject) continue;
    if (it.direction === "inbound" && inbound === null) inbound = it.subject;
    else if (it.direction === "outbound" && outbound === null) outbound = it.subject;
    if (inbound !== null && outbound !== null) break;
  }
  const base = (inbound || outbound || "Outreach").trim();
  return base.toLowerCase().startsWith("re:") ? base : `Re: ${base}`;
}
