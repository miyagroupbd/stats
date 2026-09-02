"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { confirmToast } from "@/lib/toast";
import { cleanReplyBody, kindLabel } from "@/lib/replies";
import type { Paginated, Reply } from "@/lib/types";
import { useDomains } from "@/lib/hooks";
import { DomainSelect } from "@/components/DomainSelect";
import { ReplyModal } from "@/components/ReplyModal";
import {
  Card,
  PageHeader,
  Spinner,
  EmptyState,
  formatDate,
} from "@/components/ui";

const LIMIT = 25;

export default function RepliesPage() {
  const { loading: domainsLoading } = useDomains();
  const [domain, setDomain] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Paginated<Reply> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Reply | null>(null);
  const [backfilling, setBackfilling] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const q = new URLSearchParams();
    if (domain) q.set("domain", domain);
    q.set("limit", String(LIMIT));
    q.set("offset", String(offset));
    api
      .get<Paginated<Reply>>(`/messages/replies?${q.toString()}`)
      .then(setData)
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : "Failed to load replies");
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [domain, offset]);

  useEffect(() => {
    load();
  }, [load]);

  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const total = data?.total ?? items.length;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + LIMIT, total);
  const hasPrev = offset > 0;
  const hasNext = offset + LIMIT < total;

  function onDomain(next: string) {
    setDomain(next);
    setOffset(0);
  }

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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Replies"
        subtitle="Every reply we have received — the lead's pain point, the email we sent, and what they actually wrote back. Open one to read the full thread and answer it."
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="label mb-1.5">Domain</div>
            <DomainSelect includeAll value={domain} onChange={onDomain} />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-ink-400">
              {total === 0 ? "No replies" : `${from}–${to} of ${total}`}
            </span>
            <button
              type="button"
              className="btn-secondary"
              onClick={doBackfill}
              disabled={backfilling}
            >
              {backfilling ? "Queuing…" : "Backfill old replies"}
            </button>
          </div>
        </div>
      </Card>

      {error && (
        <Card>
          <p className="text-sm text-red-300">{error}</p>
        </Card>
      )}

      <Card className="!p-0 overflow-hidden">
        {loading || domainsLoading ? (
          <Spinner label="Loading replies…" />
        ) : items.length === 0 ? (
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
                {items.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setSelected(r)}
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

      {(hasPrev || hasNext) && (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={!hasPrev}
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
          >
            Previous
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!hasNext}
            onClick={() => setOffset(offset + LIMIT)}
          >
            Next
          </button>
        </div>
      )}

      {selected && (
        <ReplyModal reply={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
