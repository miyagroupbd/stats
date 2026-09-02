// Shared reply helpers, used by the Messages outbox and the Replies board.
// Lifted out of the messages page when Replies became its own route so both
// surfaces strip quoted history identically — a reply that reads clean in one
// place and bloated in the other is worse than either alone.

export const KIND_LABELS: Record<string, string> = {
  initial: "Initial",
  followup_1: "Follow-up 1",
  followup_2: "Follow-up 2",
  followup_3: "Follow-up 3",
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
