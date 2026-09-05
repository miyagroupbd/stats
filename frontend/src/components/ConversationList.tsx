"use client";

// Left pane of Messages → Chats: one row per lead with real correspondence,
// newest activity first. Owns its own domain/search/paging state and polls
// GET /conversations every 30s while mounted so new replies surface without
// a manual refresh.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Conversation, ConversationPage } from "@/lib/types";
import { DomainSelect } from "@/components/DomainSelect";
import { EmptyState, Spinner } from "@/components/ui";
import { initialsOf, leadDisplayName, relativeTime } from "@/lib/replies";

const LIMIT = 50;
const POLL_MS = 30_000;
const SEARCH_DEBOUNCE_MS = 300;

const SOURCE_DOT: Record<string, { cls: string; label: string }> = {
  pipeline: { cls: "bg-teal-400", label: "Last item: pipeline send" },
  board: { cls: "bg-indigo-400", label: "Last item: sent from this board" },
  mailbox: { cls: "bg-amber-400", label: "Last item: seen in the mailbox" },
};

export interface ConversationListProps {
  selectedLeadId: number | null;
  onSelect: (conversation: Conversation) => void;
  /** Bump to reload immediately without a spinner (e.g. after a reply is sent). */
  refreshKey?: number;
  /** Display classes are the caller's job (`flex` / `hidden md:flex`, width). */
  className?: string;
}

export function ConversationList({
  selectedLeadId,
  onSelect,
  refreshKey = 0,
  className = "",
}: ConversationListProps) {
  const [domain, setDomain] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ConversationPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Debounced search: the input updates instantly, the query 300ms later.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [qInput]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (domain) p.set("domain", domain);
    if (q) p.set("q", q);
    p.set("limit", String(LIMIT));
    p.set("offset", String(offset));
    return p.toString();
  }, [domain, q, offset]);

  // Monotonic request counter so a slow earlier response never overwrites a
  // newer one (typing fast in the search box, or a poll racing a filter change).
  const seq = useRef(0);

  const load = useCallback(
    (silent: boolean) => {
      const mine = ++seq.current;
      if (!silent) setLoading(true);
      return api
        .get<ConversationPage>(`/conversations?${query}`)
        .then((d) => {
          if (mine !== seq.current) return;
          setData(d);
          setError(null);
          setNow(Date.now());
        })
        .catch((e) => {
          if (mine !== seq.current) return;
          setError(e instanceof ApiError ? e.message : "Failed to load conversations");
          if (!silent) setData(null);
        })
        .finally(() => {
          if (mine === seq.current && !silent) setLoading(false);
        });
    },
    [query]
  );

  // Initial load + every filter/page change.
  useEffect(() => {
    load(false);
  }, [load]);

  // External refresh (after a send) — silent so the list does not flash.
  const lastRefresh = useRef(refreshKey);
  useEffect(() => {
    if (lastRefresh.current === refreshKey) return;
    lastRefresh.current = refreshKey;
    load(true);
  }, [refreshKey, load]);

  // Poll while mounted; cleared on unmount and re-armed when the query changes.
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      load(true);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + LIMIT, total);
  const hasPrev = offset > 0;
  const hasNext = offset + LIMIT < total;

  function onDomain(slug: string) {
    setDomain(slug);
    setOffset(0);
  }
  function onSearch(v: string) {
    setQInput(v);
    setOffset(0);
  }

  return (
    <aside className={`flex-col min-h-0 min-w-0 bg-[#111b21] text-ink-100 ${className}`}>
      {/* Filters */}
      <div className="shrink-0 border-b border-[#202c33] p-3 space-y-2">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 text-sm">
            ⌕
          </span>
          <input
            type="search"
            value={qInput}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search name, company or email…"
            aria-label="Search conversations"
            className="w-full bg-[#202c33] rounded-lg pl-8 pr-3 py-2 text-sm text-ink-100 placeholder:text-ink-400 outline-none border border-[#2a3942] focus:border-emerald-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <DomainSelect
            includeAll
            value={domain}
            onChange={onDomain}
            className="!max-w-none !bg-[#202c33] !border-[#2a3942] !py-1.5 text-xs"
          />
          <span className="shrink-0 text-[11px] text-ink-400 whitespace-nowrap">
            {total === 0 ? "" : `${from}–${to} of ${total}`}
          </span>
        </div>
      </div>

      {/* Rows */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        {loading ? (
          <Spinner label="Loading conversations…" />
        ) : error ? (
          <div className="p-4 text-sm text-rose-300 break-words">{error}</div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No conversations yet"
            hint={
              q || domain
                ? "Nothing matches this search or arm."
                : "A lead shows up here once we have sent them something or they have written back."
            }
          />
        ) : (
          <ul className="divide-y divide-[#202c33]/70">
            {items.map((c) => {
              const title = leadDisplayName(c.lead_name, c.company, c.lead_email);
              const selected = c.lead_id === selectedLeadId;
              const ourTurn = c.last_direction === "inbound";
              const dot = SOURCE_DOT[c.last_source] ?? SOURCE_DOT.pipeline;
              const preview = c.last_preview?.trim() || c.lead_email || "";
              return (
                <li key={c.lead_id}>
                  <button
                    type="button"
                    onClick={() => onSelect(c)}
                    aria-current={selected ? "true" : undefined}
                    className={`w-full text-left flex items-center gap-3 px-3 py-2.5 transition-colors cursor-pointer ${
                      selected ? "bg-[#2a3942]" : "hover:bg-[#202c33]"
                    }`}
                  >
                    <div className="h-11 w-11 shrink-0 rounded-full bg-emerald-700 text-white font-bold text-sm grid place-items-center">
                      {initialsOf(title)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2 min-w-0">
                        <span className="truncate font-semibold text-[#e9edef] text-sm">
                          {title}
                        </span>
                        <span
                          className={`shrink-0 text-[11px] ${
                            ourTurn ? "text-emerald-400 font-semibold" : "text-ink-400"
                          }`}
                          title={new Date(c.last_at).toLocaleString()}
                        >
                          {relativeTime(c.last_at, now)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-ink-400 min-w-0 mt-0.5">
                        <span
                          className={`shrink-0 text-[11px] font-bold ${
                            ourTurn ? "text-emerald-400" : "text-[#53bdeb]"
                          }`}
                          title={
                            ourTurn
                              ? "They wrote last — your turn"
                              : "You wrote last — their turn"
                          }
                        >
                          {ourTurn ? "↩" : "✓✓"}
                        </span>
                        <span className="truncate flex-1">{preview}</span>
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${dot.cls}`}
                          title={dot.label}
                        />
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Paging */}
      {(hasPrev || hasNext) && (
        <div className="shrink-0 border-t border-[#202c33] px-3 py-2 flex items-center justify-between gap-2 text-xs">
          <button
            type="button"
            className="rounded-md px-2.5 py-1 text-ink-300 hover:bg-[#202c33] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
            disabled={!hasPrev}
          >
            ← Prev
          </button>
          <span className="text-ink-400">
            {from}–{to} of {total}
          </span>
          <button
            type="button"
            className="rounded-md px-2.5 py-1 text-ink-300 hover:bg-[#202c33] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            onClick={() => setOffset(offset + LIMIT)}
            disabled={!hasNext}
          >
            Next →
          </button>
        </div>
      )}
    </aside>
  );
}
