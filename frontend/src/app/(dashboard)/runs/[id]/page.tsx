"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Run, RunLog } from "@/lib/types";
import {
  Card,
  PageHeader,
  StatusBadge,
  Spinner,
  EmptyState,
  formatDate,
} from "@/components/ui";

const POLL_MS = 1500;
const MAX_INIT_RETRIES = 3;

// ── local helpers ────────────────────────────────────────────────────────────
function humanDuration(run: Run | null): string {
  if (!run) return "—";
  const start = new Date(run.started_at).getTime();
  if (Number.isNaN(start)) return "—";
  const end = run.finished_at ? new Date(run.finished_at).getTime() : Date.now();
  let s = Math.max(0, Math.round((end - start) / 1000));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m || h) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

function logTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour12: false });
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="mt-1 text-sm text-ink-100">{children}</div>
    </div>
  );
}

function statValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [run, setRun] = useState<Run | null>(null);
  const [logs, setLogs] = useState<RunLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cursorRef = useRef(0);
  const statusRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);

  // Auto-scroll only the log container (never the whole page) to the newest
  // line — and only when the viewer was already parked near the bottom.
  useEffect(() => {
    if (!stickRef.current) return;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  // Initial load + live-log polling loop. A cursor (last seen log id) is advanced
  // on every fetch; polling stops once the run is no longer "running" AND a poll
  // returned no new logs.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    cursorRef.current = 0;
    statusRef.current = null;
    setLoading(true);
    setLogs([]);
    setError(null);

    function ingest(fresh: RunLog[]) {
      if (!fresh.length) return;
      // Decide BEFORE the DOM grows whether to stick to the bottom: only when
      // the viewer is already near the bottom (or the container isn't mounted).
      const el = containerRef.current;
      stickRef.current =
        !el || el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
      cursorRef.current = fresh.reduce(
        (max, l) => (l.id > max ? l.id : max),
        cursorRef.current,
      );
      setLogs((prev) => [...prev, ...fresh]);
    }

    async function poll() {
      if (cancelled) return;
      try {
        // Refetch the run each tick so a status change (running → succeeded/…) is
        // detected and the stats/header stay live.
        const r = await api.get<Run>(`/runs/${id}`);
        if (cancelled) return;
        setRun(r);
        statusRef.current = r.status;

        const fresh = await api.get<RunLog[]>(
          `/runs/${id}/logs?after=${cursorRef.current}`,
        );
        if (cancelled) return;
        ingest(fresh);
        setError(null);

        if (r.status === "running" || fresh.length > 0) {
          timer = setTimeout(poll, POLL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : "Live log stream interrupted",
        );
        // Only keep retrying while the run is (presumably) still active.
        if (statusRef.current === "running") timer = setTimeout(poll, POLL_MS * 2);
      }
    }

    // Initial load. A transient failure shouldn't be terminal for a run that
    // may still be alive, so retry a bounded number of times before giving up.
    async function initialLoad(attempt: number) {
      if (cancelled) return;
      try {
        const r = await api.get<Run>(`/runs/${id}`);
        if (cancelled) return;
        setRun(r);
        statusRef.current = r.status;

        const first = await api.get<RunLog[]>(`/runs/${id}/logs?after=0`);
        if (cancelled) return;
        ingest(first);
        setError(null);
        setLoading(false);

        if (r.status === "running" || first.length > 0) {
          timer = setTimeout(poll, POLL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Failed to load run");
        if (attempt < MAX_INIT_RETRIES) {
          // Keep the spinner up and retry shortly.
          timer = setTimeout(() => initialLoad(attempt + 1), POLL_MS * 2);
        } else {
          setLoading(false);
        }
      }
    }

    void initialLoad(0);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  const backLink = (
    <Link href="/runs" className="btn btn-ghost">
      ← Back to runs
    </Link>
  );

  if (loading) {
    return (
      <>
        <PageHeader title={`Run #${id ?? ""}`} actions={backLink} />
        <Card>
          <Spinner label="Loading run…" />
        </Card>
      </>
    );
  }

  if (!run) {
    return (
      <>
        <PageHeader title={`Run #${id ?? ""}`} actions={backLink} />
        <Card>
          <EmptyState
            title={error || "Run not found"}
            hint="It may have been removed, or the id is invalid."
          />
        </Card>
      </>
    );
  }

  const isRunning = run.status === "running";
  const stats = run.stats && Object.keys(run.stats).length ? run.stats : null;

  return (
    <>
      <PageHeader
        title={`Run #${run.id}`}
        subtitle={`${run.mode} run${run.stage ? ` · ${run.stage}` : ""}`}
        actions={backLink}
      />

      {/* Header meta */}
      <Card>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-5">
          <Meta label="Mode">
            <span className="capitalize">{run.mode}</span>
          </Meta>
          <Meta label="Status">
            <span className="inline-flex items-center gap-2">
              <StatusBadge value={run.status} />
              {isRunning && (
                <span className="inline-block w-2 h-2 rounded-full bg-amber animate-pulse" />
              )}
            </span>
          </Meta>
          <Meta label="Triggered by">{run.triggered_by || "—"}</Meta>
          <Meta label="Started">{formatDate(run.started_at)}</Meta>
          <Meta label="Finished">
            {run.finished_at ? formatDate(run.finished_at) : isRunning ? "in progress" : "—"}
          </Meta>
          <Meta label="Duration">{humanDuration(run)}</Meta>
        </div>
      </Card>

      {run.error && (
        <div className="mt-4 text-sm text-rose bg-rose/10 border border-rose/30 rounded-lg px-4 py-3 whitespace-pre-wrap font-mono">
          {run.error}
        </div>
      )}

      {/* Stats */}
      <div className="mt-4">
        <Card>
          <div className="label mb-3">Stats</div>
          {stats ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {Object.entries(stats).map(([k, v]) => (
                <div key={k} className="card-2 px-3 py-2.5">
                  <div className="text-[0.7rem] uppercase tracking-wide text-ink-400 truncate">
                    {k.replace(/_/g, " ")}
                  </div>
                  <div className="mt-0.5 text-lg font-semibold text-ink-100 break-words">
                    {statValue(v)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-ink-400">No stats reported.</div>
          )}
        </Card>
      </div>

      {/* Live logs */}
      <div className="mt-4">
        <Card>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="label">Live logs</div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-ink-400">{logs.length} lines</span>
              {isRunning ? (
                <span className="inline-flex items-center gap-1.5 text-accent">
                  <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />
                  streaming
                </span>
              ) : (
                <span className="text-ink-400">idle</span>
              )}
            </div>
          </div>

          {error && (
            <div className="mb-3 text-xs text-rose bg-rose/10 border border-rose/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {logs.length === 0 ? (
            <EmptyState
              title="No logs yet"
              hint={isRunning ? "Waiting for the run to emit output…" : "This run produced no logs."}
            />
          ) : (
            <div
              ref={containerRef}
              className="font-mono text-xs bg-ink-950 rounded-lg p-4 max-h-[60vh] overflow-y-auto border border-ink-800"
            >
              {logs.map((l) => {
                const level = (l.level || "").toLowerCase();
                const msgColor =
                  level === "error"
                    ? "text-rose"
                    : level === "warn" || level === "warning"
                      ? "text-amber"
                      : "text-ink-300";
                return (
                  <div key={l.id} className="flex gap-2 leading-relaxed">
                    <span className="text-ink-600 shrink-0 tabular-nums">
                      {logTime(l.created_at)}
                    </span>
                    {l.agent && (
                      <span className="text-accent shrink-0">[{l.agent}]</span>
                    )}
                    <span className={`${msgColor} whitespace-pre-wrap break-words`}>
                      {l.message}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
