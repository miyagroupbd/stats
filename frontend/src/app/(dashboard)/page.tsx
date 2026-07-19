"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import { api, ApiError } from "@/lib/api";
import { useDomains } from "@/lib/hooks";
import type { Overview, Run, DomainStat } from "@/lib/types";
import {
  Card,
  PageHeader,
  StatusBadge,
  Spinner,
  EmptyState,
  formatDate,
} from "@/components/ui";

// ── Local helpers ────────────────────────────────────────────────────────────

// Backend may express reply_rate as a fraction (0–1) or an already-scaled
// percentage. Normalise defensively so the number is always shown as a %.
function pct(value: number | null | undefined): string {
  if (value == null) return "0%";
  const n = value <= 1 ? value * 100 : value;
  return `${n.toFixed(1)}%`;
}

function fmtNum(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString();
}

// Canonical lead status ordering + colour, mirrors the shared StatusBadge map.
const STATUS_ORDER = [
  "new",
  "qualified",
  "queued",
  "contacted",
  "replied",
  "converted",
  "bounced",
  "dead",
  "suppressed",
];
const STATUS_FILL: Record<string, string> = {
  new: "#7c8aa8",
  qualified: "#6366f1",
  queued: "#f59e0b",
  contacted: "#2dd4bf",
  replied: "#10b981",
  converted: "#10b981",
  bounced: "#f43f5e",
  dead: "#7c8aa8",
  suppressed: "#f43f5e",
};

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div className="card p-5 relative overflow-hidden">
      <span
        className="absolute left-0 top-0 h-full w-1"
        style={{ background: accent }}
      />
      <div className="label mb-2">{label}</div>
      <div className="text-3xl font-bold text-ink-100 tabular-nums leading-none">
        {value}
      </div>
      {sub && <div className="text-xs text-ink-400 mt-2">{sub}</div>}
    </div>
  );
}

export default function OverviewPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { domains } = useDomains();

  // Map domain_id → name so recent runs show the domain name, not "Domain {id}".
  const domainNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const d of domains) m.set(d.id, d.name);
    return m;
  }, [domains]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [ov, rn] = await Promise.all([
        api.get<Overview>("/stats/overview"),
        api.get<Run[]>("/runs/?limit=8"),
      ]);
      setOverview(ov);
      setRuns(rn);
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : "Failed to load overview data.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chartData = overview
    ? Object.entries(overview.status_breakdown)
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => {
          const ia = STATUS_ORDER.indexOf(a.status);
          const ib = STATUS_ORDER.indexOf(b.status);
          return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        })
    : [];

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="Pipeline health across every domain"
        actions={
          <button
            className="btn btn-ghost"
            onClick={load}
            disabled={loading}
          >
            ↻ Refresh
          </button>
        }
      />

      {error && (
        <div className="card-2 p-4 mb-6 text-sm text-rose border border-rose/40">
          {error}
        </div>
      )}

      {loading && !overview ? (
        <Spinner label="Loading overview…" />
      ) : !overview ? (
        <EmptyState
          title="No data yet"
          hint="Once domains and leads exist, stats appear here."
        />
      ) : (
        <div className="space-y-6">
          {/* ── Stat cards ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <StatCard
              label="Total Leads"
              value={fmtNum(overview.total_leads)}
              accent="#6366f1"
            />
            <StatCard
              label="Active Domains"
              value={`${overview.active_domains}/${overview.domains}`}
              sub="active / total"
              accent="#2dd4bf"
            />
            <StatCard
              label="Contacted"
              value={fmtNum(overview.total_contacted)}
              accent="#f59e0b"
            />
            <StatCard
              label="Replied"
              value={fmtNum(overview.total_replied)}
              sub={`${fmtNum(overview.total_bounced)} bounced`}
              accent="#10b981"
            />
            <StatCard
              label="Reply Rate"
              value={pct(overview.reply_rate)}
              accent="#2dd4bf"
            />
            <StatCard
              label="Messages Sent"
              value={fmtNum(overview.messages_sent)}
              accent="#f43f5e"
            />
          </div>

          {/* ── Chart + recent runs ────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-ink-100">
                  Lead status breakdown
                </h2>
                <span className="text-xs text-ink-400">
                  {fmtNum(overview.total_leads)} leads
                </span>
              </div>
              {chartData.length === 0 ? (
                <EmptyState title="No leads yet" />
              ) : (
                <div className="h-72 -ml-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={chartData}
                      margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#263149"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="status"
                        stroke="#7c8aa8"
                        fontSize={11}
                        tickLine={false}
                        axisLine={{ stroke: "#263149" }}
                      />
                      <YAxis
                        stroke="#7c8aa8"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip
                        cursor={{ fill: "#1a223466" }}
                        contentStyle={{
                          background: "#141b2b",
                          border: "1px solid #263149",
                          borderRadius: 10,
                          color: "#e7ecf6",
                          fontSize: 12,
                        }}
                        labelStyle={{ color: "#a9b4cc" }}
                      />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={54}>
                        {chartData.map((d) => (
                          <Cell
                            key={d.status}
                            fill={STATUS_FILL[d.status] || "#2dd4bf"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            {/* Recent runs */}
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-ink-100">
                  Recent runs
                </h2>
                <Link
                  href="/runs"
                  className="text-xs text-accent hover:underline"
                >
                  View all →
                </Link>
              </div>
              {runs.length === 0 ? (
                <EmptyState title="No runs yet" hint="Trigger a run to begin." />
              ) : (
                <ul className="space-y-1">
                  {runs.map((r) => (
                    <li key={r.id}>
                      <Link
                        href={`/runs/${r.id}`}
                        className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 -mx-1 hover:bg-ink-850 transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-ink-100 capitalize">
                              {r.mode}
                            </span>
                            <span className="text-xs text-ink-400">
                              #{r.id}
                            </span>
                          </div>
                          <div className="text-xs text-ink-400 mt-0.5 truncate">
                            {r.domain_id == null
                              ? "All domains"
                              : domainNameById.get(r.domain_id) ??
                                `#${r.domain_id}`}{" "}
                            · {formatDate(r.started_at)}
                          </div>
                        </div>
                        <StatusBadge value={r.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* ── Per-domain table ───────────────────────────────────────── */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-ink-100">
                Per-domain performance
              </h2>
              <span className="text-xs text-ink-400">
                {overview.per_domain.length} domains
              </span>
            </div>
            {overview.per_domain.length === 0 ? (
              <EmptyState
                title="No domains configured"
                hint="Add a domain to start tracking leads."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-left text-xs uppercase tracking-wide text-ink-400 font-semibold py-2 px-3">
                        Domain
                      </th>
                      <th className="text-left text-xs uppercase tracking-wide text-ink-400 font-semibold py-2 px-3">
                        Active
                      </th>
                      <th className="text-right text-xs uppercase tracking-wide text-ink-400 font-semibold py-2 px-3">
                        Leads
                      </th>
                      <th className="text-right text-xs uppercase tracking-wide text-ink-400 font-semibold py-2 px-3">
                        Contacted
                      </th>
                      <th className="text-right text-xs uppercase tracking-wide text-ink-400 font-semibold py-2 px-3">
                        Replied
                      </th>
                      <th className="text-right text-xs uppercase tracking-wide text-ink-400 font-semibold py-2 px-3">
                        Reply rate
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.per_domain.map((d: DomainStat) => (
                      <tr
                        key={d.slug}
                        className="border-t border-ink-800 hover:bg-ink-850"
                      >
                        <td className="py-2.5 px-3">
                          <Link
                            href={`/domains/${d.slug}`}
                            className="font-medium text-ink-100 hover:text-accent"
                          >
                            {d.name}
                          </Link>
                          <div className="text-xs text-ink-400">{d.slug}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          {d.is_active ? (
                            <span className="badge text-emerald border-emerald/40 bg-emerald/10">
                              active
                            </span>
                          ) : (
                            <span className="badge text-ink-400">off</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-ink-300">
                          {fmtNum(d.total_leads)}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-ink-300">
                          {fmtNum(d.contacted)}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-ink-300">
                          {fmtNum(d.replied)}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-medium text-accent">
                          {pct(d.reply_rate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
