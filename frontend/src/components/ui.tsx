// Reusable presentational primitives shared across dashboard pages.
import { ReactNode } from "react";

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_COLORS: Record<string, string> = {
  new: "#7c8aa8",
  qualified: "#6366f1",
  queued: "#f59e0b",
  contacted: "#2dd4bf",
  replied: "#10b981",
  bounced: "#f43f5e",
  converted: "#10b981",
  dead: "#7c8aa8",
  suppressed: "#f43f5e",
  running: "#f59e0b",
  succeeded: "#10b981",
  failed: "#f43f5e",
  cancelled: "#7c8aa8",
  drafted: "#7c8aa8",
  sent: "#2dd4bf",
  active: "#10b981",
  draft: "#7c8aa8",
  paused: "#f59e0b",
  completed: "#6366f1",
  // N8N execution/workflow statuses
  success: "#10b981",
  succeeded_n8n: "#10b981",
  error: "#f43f5e",
  crashed: "#f43f5e",
  waiting: "#f59e0b",
  unknown: "#7c8aa8",
};

const PRIORITY_COLORS: Record<string, string> = {
  hot: "#f43f5e",
  warm: "#f59e0b",
  cool: "#2dd4bf",
  cold: "#7c8aa8",
};

export function StatusBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-ink-400">—</span>;
  const color = STATUS_COLORS[value] || "#7c8aa8";
  return (
    <span
      className="badge"
      style={{ color, borderColor: `${color}55`, background: `${color}18` }}
    >
      {value}
    </span>
  );
}

export function PriorityBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-ink-400">—</span>;
  const color = PRIORITY_COLORS[value] || "#7c8aa8";
  return (
    <span className="badge" style={{ color, borderColor: `${color}55`, background: `${color}18` }}>
      {value}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-ink-400 text-sm py-8 justify-center">
      <span className="inline-block w-4 h-4 border-2 border-ink-600 border-t-accent rounded-full animate-spin" />
      {label || "Loading…"}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="text-center py-16 text-ink-400">
      <div className="text-ink-300 font-medium">{title}</div>
      {hint && <div className="text-sm mt-1">{hint}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card p-5 ${className}`}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
      <div>
        <h1 className="text-2xl font-bold text-ink-100">{title}</h1>
        {subtitle && <p className="text-ink-400 text-sm mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
