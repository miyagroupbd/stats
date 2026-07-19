"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { AutomationSummary, N8nExecution, N8nWorkflow } from "@/lib/types";
import {
  Card,
  EmptyState,
  PageHeader,
  Spinner,
  StatusBadge,
  formatDate,
} from "@/components/ui";

const REFRESH_MS = 20000;

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-ink-400 font-semibold">{label}</div>
      <div className="text-3xl font-bold mt-1" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
    </Card>
  );
}

export default function AutomationsPage() {
  const [summary, setSummary] = useState<AutomationSummary | null>(null);
  const [workflows, setWorkflows] = useState<N8nWorkflow[]>([]);
  const [executions, setExecutions] = useState<N8nExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, w, e] = await Promise.all([
        api.get<AutomationSummary>("/automations/summary"),
        api.get<{ configured: boolean; items: N8nWorkflow[] }>("/automations/workflows?limit=100"),
        api.get<{ configured: boolean; items: N8nExecution[] }>("/automations/executions?limit=50"),
      ]);
      setSummary(s);
      setWorkflows(w.items || []);
      setExecutions(e.items || []);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load automations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  if (loading) return <Spinner label="Loading automations…" />;

  return (
    <>
      <PageHeader
        title="Automations"
        subtitle="N8N workflow health and recent executions"
      />

      {error && (
        <div className="text-sm text-rose bg-rose/10 border border-rose/30 rounded-lg px-3 py-2 mb-4">
          {error}
        </div>
      )}

      {summary && !summary.configured && (
        <Card className="mb-6">
          <div className="font-semibold text-ink-100">N8N not connected</div>
          <p className="text-sm text-ink-400 mt-1">
            Set <code className="text-accent">N8N_BASE_URL</code> and{" "}
            <code className="text-accent">N8N_API_KEY</code> on the stats backend to pull
            workflow and execution reports. (N8N → Settings → API → create an API key.)
          </p>
        </Card>
      )}

      {summary?.configured && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 mb-6">
          <Stat label="Workflows" value={summary.workflows} />
          <Stat label="Active" value={summary.active_workflows} tone="#10b981" />
          <Stat label="Succeeded" value={summary.succeeded} tone="#2dd4bf" />
          <Stat label="Failed" value={summary.failed} tone="#f43f5e" />
          <Stat
            label="Success rate"
            value={`${Math.round((summary.success_rate || 0) * 100)}%`}
          />
        </div>
      )}

      <Card className="mb-6">
        <h2 className="font-semibold text-ink-100 mb-3">Workflows</h2>
        {workflows.length === 0 ? (
          <EmptyState title="No workflows" hint="Nothing returned from N8N yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {["Name", "Status", "Tags", "Updated"].map((h) => (
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
                {workflows.map((w) => (
                  <tr key={w.id} className="border-t border-ink-800 hover:bg-ink-850">
                    <td className="py-2 px-3 text-ink-100">{w.name}</td>
                    <td className="py-2 px-3">
                      <StatusBadge value={w.active ? "active" : "paused"} />
                    </td>
                    <td className="py-2 px-3 text-ink-400">{w.tags.join(", ") || "—"}</td>
                    <td className="py-2 px-3 text-ink-400">{formatDate(w.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold text-ink-100 mb-3">Recent executions</h2>
        {executions.length === 0 ? (
          <EmptyState title="No executions" hint="No runs reported by N8N." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {["Workflow", "Status", "Mode", "Started", "Finished"].map((h) => (
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
                {executions.map((e) => (
                  <tr key={e.id} className="border-t border-ink-800 hover:bg-ink-850">
                    <td className="py-2 px-3 text-ink-100">
                      {e.workflow_name || e.workflow_id || "—"}
                    </td>
                    <td className="py-2 px-3">
                      <StatusBadge value={e.status} />
                    </td>
                    <td className="py-2 px-3 text-ink-400">{e.mode || "—"}</td>
                    <td className="py-2 px-3 text-ink-400">{formatDate(e.started_at)}</td>
                    <td className="py-2 px-3 text-ink-400">{formatDate(e.stopped_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
