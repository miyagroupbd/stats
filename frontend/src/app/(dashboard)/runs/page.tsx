"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useDomains } from "@/lib/hooks";
import type { Run } from "@/lib/types";
import { DomainSelect } from "@/components/DomainSelect";
import {
  Card,
  PageHeader,
  StatusBadge,
  Spinner,
  EmptyState,
  formatDate,
} from "@/components/ui";

const MODES = ["full", "daily", "monitor", "report"] as const;
type Mode = (typeof MODES)[number];

/** Human-readable elapsed time between two ISO timestamps. */
function fmtDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return "";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

export default function RunsPage() {
  const router = useRouter();
  const { domains } = useDomains();

  // ── Trigger-run control state ──────────────────────────────────────────────
  const [triggerSlug, setTriggerSlug] = useState("");
  const [mode, setMode] = useState<Mode>("full");
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  // Default the trigger domain to the first one once domains load.
  useEffect(() => {
    if (!triggerSlug && domains.length) setTriggerSlug(domains[0].slug);
  }, [domains, triggerSlug]);

  // ── List state ─────────────────────────────────────────────────────────────
  const [filterSlug, setFilterSlug] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Map domain_id → name for a friendlier Domain column.
  const domainNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const d of domains) m.set(d.id, d.name);
    return m;
  }, [domains]);

  const filterRef = useRef(filterSlug);
  filterRef.current = filterSlug;

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const slug = filterRef.current;
    try {
      const qs = new URLSearchParams({ limit: "50" });
      if (slug) qs.set("domain", slug);
      const data = await api.get<Run[]>(`/runs/?${qs.toString()}`);
      setRuns(data);
      setListError(null);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Failed to load runs");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Reload on filter change + poll every 5s so running rows update live.
  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 5000);
    return () => clearInterval(t);
  }, [filterSlug, load]);

  async function triggerRun() {
    if (!triggerSlug || triggering) return;
    setTriggering(true);
    setTriggerError(null);
    try {
      const res = await api.post<{ run_id: number }>("/runs/", {
        domain_slug: triggerSlug,
        mode,
      });
      router.push("/runs/" + res.run_id);
    } catch (e) {
      setTriggerError(e instanceof Error ? e.message : "Failed to start run");
      setTriggering(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Runs"
        subtitle="Trigger pipeline runs and watch execution history in real time."
      />

      {/* ── Trigger run ─────────────────────────────────────────────────────── */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="label mb-1.5">Domain</div>
            <DomainSelect value={triggerSlug} onChange={setTriggerSlug} />
          </div>
          <div>
            <div className="label mb-1.5">Mode</div>
            <select
              className="input max-w-[180px]"
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
            >
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <button
            className="btn btn-primary"
            onClick={triggerRun}
            disabled={!triggerSlug || triggering}
            style={{ opacity: !triggerSlug || triggering ? 0.6 : 1 }}
          >
            {triggering ? "Starting…" : "▸ Run now"}
          </button>
          {triggerError && (
            <span className="text-rose text-sm">{triggerError}</span>
          )}
        </div>
      </Card>

      {/* ── History ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="label">Filter</span>
          <DomainSelect value={filterSlug} onChange={setFilterSlug} includeAll />
        </div>
        <span className="text-ink-400 text-xs">Auto-refreshing every 5s</span>
      </div>

      <Card className="!p-0 overflow-hidden">
        {listError && (
          <div className="text-rose text-sm px-5 py-3 border-b border-ink-800">
            {listError}
          </div>
        )}

        {loading ? (
          <Spinner label="Loading runs…" />
        ) : runs.length === 0 ? (
          <EmptyState
            title="No runs yet"
            hint="Trigger a run above to kick off the pipeline."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {[
                    "#",
                    "Domain",
                    "Mode",
                    "Status",
                    "Triggered by",
                    "Started",
                    "Duration",
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
                {runs.map((r) => {
                  const running = !r.finished_at;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => router.push("/runs/" + r.id)}
                      className="border-t border-ink-800 hover:bg-ink-850 cursor-pointer"
                    >
                      <td className="py-2.5 px-3 font-mono text-ink-300">
                        {r.id}
                      </td>
                      <td className="py-2.5 px-3 text-ink-100">
                        {r.domain_id == null
                          ? "—"
                          : domainNameById.get(r.domain_id) ??
                            `#${r.domain_id}`}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-indigo font-medium">{r.mode}</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <StatusBadge value={r.status} />
                      </td>
                      <td className="py-2.5 px-3 text-ink-300">
                        {r.triggered_by || "—"}
                      </td>
                      <td className="py-2.5 px-3 text-ink-300">
                        {formatDate(r.started_at)}
                      </td>
                      <td className="py-2.5 px-3">
                        {running ? (
                          <span className="inline-flex items-center gap-1.5 text-amber">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber animate-pulse" />
                            running
                          </span>
                        ) : (
                          <span className="text-ink-300 font-mono">
                            {fmtDuration(r.started_at, r.finished_at)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
