"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Domain, IcpSegment } from "@/lib/types";
import { Card, PageHeader, Spinner, EmptyState } from "@/components/ui";

// ── Editable form model (flattened from Domain; icp held as raw JSON text) ────
interface Form {
  name: string;
  website: string;
  is_active: boolean;
  from_name: string;
  from_email: string;
  reply_to: string;
  signature: string;
  model: string;
  ai_context: string;
  icpText: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_password: string;
  smtp_secure: boolean;
  imap_host: string;
  imap_port: number;
  daily_limit: number;
  batch_size: number;
  batch_delay_sec: number;
  send_days: number[];
  send_hour_start: number;
  send_hour_end: number;
  follow_up_days: number;
  max_follow_ups: number;
  confidence_threshold: number;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function seed(d: Domain): Form {
  return {
    name: d.name ?? "",
    website: d.website ?? "",
    is_active: d.is_active,
    from_name: d.from_name ?? "",
    from_email: d.from_email ?? "",
    reply_to: d.reply_to ?? "",
    signature: d.signature ?? "",
    model: d.model ?? "",
    ai_context: d.ai_context ?? "",
    icpText: d.icp_segments ? JSON.stringify(d.icp_segments, null, 2) : "",
    smtp_host: d.smtp_host ?? "",
    smtp_port: d.smtp_port ?? 587,
    smtp_user: d.smtp_user ?? "",
    smtp_password: "",
    smtp_secure: d.smtp_secure,
    imap_host: d.imap_host ?? "",
    imap_port: d.imap_port ?? 993,
    daily_limit: d.daily_limit,
    batch_size: d.batch_size,
    batch_delay_sec: d.batch_delay_sec,
    send_days: d.send_days ?? [0, 1, 2, 3, 4],
    send_hour_start: d.send_hour_start,
    send_hour_end: d.send_hour_end,
    follow_up_days: d.follow_up_days,
    max_follow_ups: d.max_follow_ups,
    confidence_threshold: d.confidence_threshold,
  };
}

const emptyNull = (v: string): string | null => (v.trim() ? v : null);

// ── Small field primitives (local to this page) ───────────────────────────────
function Field({
  label,
  children,
  hint,
  className = "",
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="label block mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-ink-400 mt-1">{hint}</p>}
    </div>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer select-none py-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[var(--color-accent-strong)]"
      />
      <span className="text-sm text-ink-300">{label}</span>
    </label>
  );
}

export default function DomainEditorPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const router = useRouter();

  const [domain, setDomain] = useState<Domain | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [icpError, setIcpError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    setLoading(true);
    setLoadError(null);
    api
      .get<Domain>(`/domains/${slug}`)
      .then((d) => {
        if (!alive) return;
        setDomain(d);
        setForm(seed(d));
      })
      .catch((e) => {
        if (!alive) return;
        setLoadError(e instanceof Error ? e.message : "Failed to load domain.");
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [slug]);

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }
  const num = (v: string): number => {
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  };

  function toggleDay(i: number) {
    setForm((f) => {
      if (!f) return f;
      const next = f.send_days.includes(i)
        ? f.send_days.filter((d) => d !== i)
        : [...f.send_days, i].sort((a, b) => a - b);
      return { ...f, send_days: next };
    });
  }

  async function onSave() {
    if (!form) return;
    // Parse ICP JSON — block save on invalid input.
    let icp: IcpSegment[] | null = null;
    if (form.icpText.trim()) {
      try {
        const parsed = JSON.parse(form.icpText);
        if (!Array.isArray(parsed)) throw new Error("ICP segments must be a JSON array.");
        icp = parsed as IcpSegment[];
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Invalid JSON.";
        setIcpError(msg);
        setToast({ ok: false, msg: `ICP segments: ${msg}` });
        return;
      }
    }
    setIcpError(null);

    const payload: Record<string, unknown> = {
      name: form.name,
      website: emptyNull(form.website),
      is_active: form.is_active,
      from_name: emptyNull(form.from_name),
      from_email: emptyNull(form.from_email),
      reply_to: emptyNull(form.reply_to),
      signature: emptyNull(form.signature),
      model: form.model,
      ai_context: emptyNull(form.ai_context),
      icp_segments: icp,
      smtp_host: form.smtp_host,
      smtp_port: form.smtp_port,
      smtp_user: emptyNull(form.smtp_user),
      smtp_secure: form.smtp_secure,
      imap_host: form.imap_host,
      imap_port: form.imap_port,
      daily_limit: form.daily_limit,
      batch_size: form.batch_size,
      batch_delay_sec: form.batch_delay_sec,
      send_days: form.send_days,
      send_hour_start: form.send_hour_start,
      send_hour_end: form.send_hour_end,
      follow_up_days: form.follow_up_days,
      max_follow_ups: form.max_follow_ups,
      confidence_threshold: form.confidence_threshold,
    };
    // Only send the password when the operator typed a new one.
    if (form.smtp_password.trim()) payload.smtp_password = form.smtp_password;

    setSaving(true);
    setToast(null);
    try {
      const updated = await api.patch<Domain>(`/domains/${slug}`, payload);
      setDomain(updated);
      setForm(seed(updated)); // reseed: clears password field, refreshes smtp_configured
      setToast({ ok: true, msg: "Saved." });
    } catch (e) {
      setToast({ ok: false, msg: e instanceof Error ? e.message : "Save failed." });
    } finally {
      setSaving(false);
    }
  }

  async function onRun() {
    setRunning(true);
    setToast(null);
    try {
      const res = await api.post<{ run_id: number }>("/runs/", {
        domain_slug: slug,
        mode: "full",
      });
      router.push(`/runs/${res.run_id}`);
    } catch (e) {
      setToast({ ok: false, msg: e instanceof Error ? e.message : "Could not start run." });
      setRunning(false);
    }
  }

  async function onDelete() {
    if (!confirm(`Delete domain "${domain?.name ?? slug}"? This cannot be undone.`)) return;
    setDeleting(true);
    setToast(null);
    try {
      await api.del(`/domains/${slug}`);
      router.push("/domains");
    } catch (e) {
      setToast({ ok: false, msg: e instanceof Error ? e.message : "Delete failed." });
      setDeleting(false);
    }
  }

  if (loading) return <Spinner label="Loading domain…" />;

  if (loadError || !form || !domain) {
    return (
      <div>
        <PageHeader
          title="Domain"
          actions={
            <Link href="/domains" className="btn btn-ghost">
              ← Domains
            </Link>
          }
        />
        {loadError && (
          <div className="text-sm text-rose bg-rose/10 border border-rose/40 rounded-lg px-4 py-3 mb-4">
            {loadError}
          </div>
        )}
        <Card>
          <EmptyState title="Domain not found" hint={`No domain "${slug}".`} />
        </Card>
      </div>
    );
  }

  const busy = saving || running || deleting;

  return (
    <div className="pb-28">
      <PageHeader
        title={form.name || slug}
        subtitle={`Editing configuration — ${slug}`}
        actions={
          <Link href="/domains" className="btn btn-ghost">
            ← Domains
          </Link>
        }
      />

      <div className="space-y-5">
        {/* (1) Identity ------------------------------------------------------ */}
        <Card>
          <h2 className="text-sm font-semibold text-ink-100 mb-4 flex items-center gap-2">
            <span className="text-accent">◆</span> Identity
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input
                className="input"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>
            <Field label="Website">
              <input
                className="input"
                placeholder="https://example.com"
                value={form.website}
                onChange={(e) => set("website", e.target.value)}
              />
            </Field>
            <Field label="From name">
              <input
                className="input"
                value={form.from_name}
                onChange={(e) => set("from_name", e.target.value)}
              />
            </Field>
            <Field label="From email">
              <input
                className="input"
                type="email"
                placeholder="hello@example.com"
                value={form.from_email}
                onChange={(e) => set("from_email", e.target.value)}
              />
            </Field>
            <Field label="Reply-to">
              <input
                className="input"
                type="email"
                value={form.reply_to}
                onChange={(e) => set("reply_to", e.target.value)}
              />
            </Field>
            <Field label="Active">
              <div className="card-2 rounded-[10px] px-3 py-2">
                <CheckRow
                  label="Domain is active (eligible for sends)"
                  checked={form.is_active}
                  onChange={(v) => set("is_active", v)}
                />
              </div>
            </Field>
            <Field label="Signature" className="sm:col-span-2">
              <textarea
                className="input font-mono text-xs"
                rows={4}
                value={form.signature}
                onChange={(e) => set("signature", e.target.value)}
              />
            </Field>
          </div>
        </Card>

        {/* (2) AI ------------------------------------------------------------ */}
        <Card>
          <h2 className="text-sm font-semibold text-ink-100 mb-4 flex items-center gap-2">
            <span className="text-indigo">◆</span> AI
          </h2>
          <div className="grid gap-4">
            <Field label="Model" className="sm:max-w-sm">
              <input
                className="input"
                placeholder="claude-…"
                value={form.model}
                onChange={(e) => set("model", e.target.value)}
              />
            </Field>
            <Field
              label="AI context"
              hint="Company background, tone, and offer — fed to the copywriter agent."
            >
              <textarea
                className="input"
                rows={9}
                value={form.ai_context}
                onChange={(e) => set("ai_context", e.target.value)}
              />
            </Field>
            <Field
              label="ICP segments (JSON array)"
              hint='Array of { "key", "label", "description" }. Must be valid JSON.'
            >
              <textarea
                className={`input font-mono text-xs ${
                  icpError ? "border-rose" : ""
                }`}
                rows={10}
                spellCheck={false}
                value={form.icpText}
                onChange={(e) => {
                  set("icpText", e.target.value);
                  if (icpError) setIcpError(null);
                }}
              />
              {icpError && (
                <p className="text-xs text-rose mt-1.5">⚠ {icpError}</p>
              )}
            </Field>
          </div>
        </Card>

        {/* (3) SMTP / IMAP --------------------------------------------------- */}
        <Card>
          <h2 className="text-sm font-semibold text-ink-100 mb-4 flex items-center gap-2">
            <span className="text-amber">◆</span> SMTP / IMAP
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="SMTP host">
              <input
                className="input"
                value={form.smtp_host}
                onChange={(e) => set("smtp_host", e.target.value)}
              />
            </Field>
            <Field label="SMTP port">
              <input
                className="input"
                type="number"
                value={form.smtp_port}
                onChange={(e) => set("smtp_port", num(e.target.value))}
              />
            </Field>
            <Field label="SMTP user">
              <input
                className="input"
                value={form.smtp_user}
                onChange={(e) => set("smtp_user", e.target.value)}
              />
            </Field>
            <Field
              label="SMTP password"
              hint={
                domain.smtp_configured
                  ? "A password is already stored. Leave blank to keep it."
                  : "No password stored yet."
              }
            >
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                placeholder={
                  domain.smtp_configured
                    ? "•••••• (set — leave blank to keep)"
                    : "not set"
                }
                value={form.smtp_password}
                onChange={(e) => set("smtp_password", e.target.value)}
              />
            </Field>
            <Field label="IMAP host">
              <input
                className="input"
                value={form.imap_host}
                onChange={(e) => set("imap_host", e.target.value)}
              />
            </Field>
            <Field label="IMAP port">
              <input
                className="input"
                type="number"
                value={form.imap_port}
                onChange={(e) => set("imap_port", num(e.target.value))}
              />
            </Field>
            <Field label="Encryption" className="sm:col-span-2">
              <div className="card-2 rounded-[10px] px-3 py-2 inline-block">
                <CheckRow
                  label="SMTP secure (TLS/SSL)"
                  checked={form.smtp_secure}
                  onChange={(v) => set("smtp_secure", v)}
                />
              </div>
            </Field>
          </div>
        </Card>

        {/* (4) Send rules ---------------------------------------------------- */}
        <Card>
          <h2 className="text-sm font-semibold text-ink-100 mb-4 flex items-center gap-2">
            <span className="text-emerald">◆</span> Send rules
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Daily limit">
              <input
                className="input"
                type="number"
                min={0}
                value={form.daily_limit}
                onChange={(e) => set("daily_limit", num(e.target.value))}
              />
            </Field>
            <Field label="Batch size">
              <input
                className="input"
                type="number"
                min={0}
                value={form.batch_size}
                onChange={(e) => set("batch_size", num(e.target.value))}
              />
            </Field>
            <Field label="Batch delay (sec)">
              <input
                className="input"
                type="number"
                min={0}
                value={form.batch_delay_sec}
                onChange={(e) => set("batch_delay_sec", num(e.target.value))}
              />
            </Field>

            <Field label="Send days" className="sm:col-span-3">
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d, i) => {
                  const on = form.send_days.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleDay(i)}
                      className={`badge px-3 py-1.5 cursor-pointer transition-colors ${
                        on
                          ? "bg-accent/15 text-accent border-accent/50"
                          : "text-ink-400 hover:bg-ink-800"
                      }`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="Send hour start (0–23)">
              <input
                className="input"
                type="number"
                min={0}
                max={23}
                value={form.send_hour_start}
                onChange={(e) => set("send_hour_start", num(e.target.value))}
              />
            </Field>
            <Field label="Send hour end (0–23)">
              <input
                className="input"
                type="number"
                min={0}
                max={23}
                value={form.send_hour_end}
                onChange={(e) => set("send_hour_end", num(e.target.value))}
              />
            </Field>
            <Field label="Confidence threshold (0–100)">
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                step={1}
                value={form.confidence_threshold}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  set(
                    "confidence_threshold",
                    Number.isNaN(n) ? 0 : Math.min(100, Math.max(0, n)),
                  );
                }}
              />
            </Field>

            <Field label="Follow-up days">
              <input
                className="input"
                type="number"
                min={0}
                value={form.follow_up_days}
                onChange={(e) => set("follow_up_days", num(e.target.value))}
              />
            </Field>
            <Field label="Max follow-ups">
              <input
                className="input"
                type="number"
                min={0}
                value={form.max_follow_ups}
                onChange={(e) => set("max_follow_ups", num(e.target.value))}
              />
            </Field>
          </div>
        </Card>
      </div>

      {/* Sticky footer action bar ------------------------------------------- */}
      <div className="sticky bottom-4 z-10 mt-5">
        <div className="card-2 p-3.5 flex items-center gap-3 flex-wrap shadow-xl shadow-black/30">
          <div className="min-w-0 flex-1">
            {toast && (
              <span
                className={`text-sm ${toast.ok ? "text-emerald" : "text-rose"}`}
              >
                {toast.ok ? "✓ " : "⚠ "}
                {toast.msg}
              </span>
            )}
          </div>
          <button
            type="button"
            className="btn btn-ghost text-rose"
            onClick={onDelete}
            disabled={busy}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onRun}
            disabled={busy}
          >
            {running ? "Starting…" : "▶ Run full pipeline"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onSave}
            disabled={busy}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
