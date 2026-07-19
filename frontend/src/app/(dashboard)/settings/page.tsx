"use client";

import { useCallback, useEffect, useState, ReactNode } from "react";
import { API_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDomains } from "@/lib/hooks";
import {
  Card,
  PageHeader,
  Spinner,
  EmptyState,
  formatDate,
} from "@/components/ui";

// ── Local presentational helpers ────────────────────────────────────────────

/** Label / value row used inside the Account & API cards. */
function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-t border-ink-800 first:border-t-0">
      <span className="label">{label}</span>
      <span className="text-sm text-ink-100 text-right min-w-0 truncate">{children}</span>
    </div>
  );
}

/** Small coloured pill for roles / yes-no flags (no reliance on StatusBadge map). */
function Pill({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="badge"
      style={{ color, borderColor: `${color}55`, background: `${color}18` }}
    >
      {children}
    </span>
  );
}

const ACCENT = "#2dd4bf";
const INDIGO = "#6366f1";
const AMBER = "#f59e0b";
const ROSE = "#f43f5e";
const EMERALD = "#10b981";
const MUTED = "#7c8aa8";

type HealthState = "checking" | "online" | "offline";

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { user } = useAuth();
  const { domains, loading: domainsLoading } = useDomains();

  const [health, setHealth] = useState<HealthState>("checking");
  const [healthDetail, setHealthDetail] = useState<string>("");
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const checkHealth = useCallback(async () => {
    setHealth("checking");
    setHealthDetail("");
    try {
      const res = await fetch(`${API_URL}/health`, { cache: "no-store" });
      if (res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as Record<string, unknown>;
          if (j && typeof j === "object" && "status" in j) detail = String(j.status);
        } catch {
          /* non-json health body — the OK status is enough */
        }
        setHealth("online");
        setHealthDetail(detail);
      } else {
        setHealth("offline");
        setHealthDetail(`HTTP ${res.status}`);
      }
    } catch (e) {
      setHealth("offline");
      setHealthDetail(e instanceof Error ? e.message : "unreachable");
    } finally {
      setCheckedAt(new Date());
    }
  }, []);

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  const healthColor =
    health === "online" ? EMERALD : health === "offline" ? ROSE : AMBER;
  const healthLabel =
    health === "online" ? "Connected" : health === "offline" ? "Unreachable" : "Checking…";

  const roleColor =
    user?.role === "superadmin" || user?.role === "admin" ? INDIGO : MUTED;

  // Provider catalogue — informational only; real secrets live in server env.
  const providers: {
    name: string;
    env: string;
    role: string;
    color: string;
  }[] = [
    {
      name: "Anthropic (Claude)",
      env: "ANTHROPIC_API_KEY",
      role: "Drafts email copy, personalises hooks, and analyses replies.",
      color: ACCENT,
    },
    {
      name: "Apollo",
      env: "APOLLO_API_KEY",
      role: "Discovers ICP-matched leads and enriches company data.",
      color: INDIGO,
    },
    {
      name: "Hunter",
      env: "HUNTER_API_KEY",
      role: "Finds and verifies deliverable email addresses.",
      color: AMBER,
    },
    {
      name: "SMTP / IMAP",
      env: "per-domain",
      role: "Sends and reads mail. Configured on each Domain, not globally.",
      color: EMERALD,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Account, API connectivity, and pipeline provider configuration."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Account */}
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-ink-400">◇</span>
            <h2 className="font-semibold text-ink-100">Account</h2>
          </div>
          {user ? (
            <div>
              <KV label="Email">{user.email}</KV>
              <KV label="Name">{user.name || <span className="text-ink-400">—</span>}</KV>
              <KV label="Role">
                <Pill color={roleColor}>{user.role}</Pill>
              </KV>
              <KV label="Status">
                {user.is_active ? (
                  <Pill color={EMERALD}>active</Pill>
                ) : (
                  <Pill color={ROSE}>inactive</Pill>
                )}
              </KV>
              <KV label="Last login">{formatDate(user.last_login_at)}</KV>
            </div>
          ) : (
            <p className="text-sm text-ink-400">No active session.</p>
          )}
        </Card>

        {/* API */}
        <Card>
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <span className="text-ink-400">⚡</span>
              <h2 className="font-semibold text-ink-100">API</h2>
            </div>
            <button
              className="btn btn-ghost text-xs py-1 px-2"
              onClick={checkHealth}
              disabled={health === "checking"}
            >
              Re-check
            </button>
          </div>
          <div>
            <KV label="Base URL">
              <code className="text-ink-300 text-xs">{API_URL}</code>
            </KV>
            <KV label="Health">
              <span className="inline-flex items-center gap-2">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: healthColor }}
                />
                <span style={{ color: healthColor }} className="font-semibold">
                  {healthLabel}
                </span>
              </span>
            </KV>
            <KV label="Endpoint">
              <code className="text-ink-400 text-xs">GET /health</code>
            </KV>
            <KV label="Response">
              <span className="text-ink-300 text-xs">
                {health === "checking" ? "…" : healthDetail || "—"}
              </span>
            </KV>
            <KV label="Last checked">
              <span className="text-ink-400 text-xs">
                {checkedAt ? checkedAt.toLocaleTimeString() : "—"}
              </span>
            </KV>
          </div>
          {health === "offline" && (
            <p className="mt-3 text-xs text-rose border border-rose/30 bg-rose/10 rounded-lg px-3 py-2">
              Could not reach the API. Confirm the backend is running and
              NEXT_PUBLIC_API_URL points at it.
            </p>
          )}
        </Card>
      </div>

      {/* Providers */}
      <Card className="mt-5">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-ink-400">◈</span>
          <h2 className="font-semibold text-ink-100">Providers</h2>
        </div>
        <p className="text-sm text-ink-400 mb-4">
          These integrations drive the pipeline. Keys are read from the server
          environment and are never exposed to the dashboard.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {providers.map((p) => (
            <div key={p.name} className="card-2 p-4">
              <div className="flex items-center justify-between gap-3 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ background: p.color }}
                  />
                  <span className="font-semibold text-ink-100 truncate">
                    {p.name}
                  </span>
                </div>
                <code className="text-[11px] text-ink-400 shrink-0">{p.env}</code>
              </div>
              <p className="text-sm text-ink-300">{p.role}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Domains health */}
      <Card className="mt-5">
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-ink-400">◎</span>
            <h2 className="font-semibold text-ink-100">Domains health</h2>
          </div>
          {!domainsLoading && domains.length > 0 && (
            <span className="text-xs text-ink-400">
              {domains.filter((d) => d.smtp_configured).length}/{domains.length} sending-ready
            </span>
          )}
        </div>

        {domainsLoading ? (
          <Spinner label="Loading domains…" />
        ) : domains.length === 0 ? (
          <EmptyState
            title="No domains configured"
            hint="Add a domain to begin running the pipeline."
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
                    From
                  </th>
                  <th className="text-left text-xs uppercase tracking-wide text-ink-400 font-semibold py-2 px-3">
                    Active
                  </th>
                  <th className="text-left text-xs uppercase tracking-wide text-ink-400 font-semibold py-2 px-3">
                    SMTP
                  </th>
                </tr>
              </thead>
              <tbody>
                {domains.map((d) => (
                  <tr key={d.slug} className="border-t border-ink-800 hover:bg-ink-850">
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-ink-100">{d.name}</div>
                      <div className="text-xs text-ink-400">{d.slug}</div>
                    </td>
                    <td className="py-2.5 px-3 text-ink-300">
                      {d.from_email || <span className="text-ink-400">—</span>}
                    </td>
                    <td className="py-2.5 px-3">
                      {d.is_active ? (
                        <Pill color={EMERALD}>active</Pill>
                      ) : (
                        <Pill color={MUTED}>inactive</Pill>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      {d.smtp_configured ? (
                        <Pill color={ACCENT}>configured</Pill>
                      ) : (
                        <Pill color={AMBER}>not set</Pill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
