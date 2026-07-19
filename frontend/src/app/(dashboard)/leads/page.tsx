"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Lead, Message, Paginated } from "@/lib/types";
import { useDomains } from "@/lib/hooks";
import { DomainSelect } from "@/components/DomainSelect";
import {
  Card,
  PageHeader,
  StatusBadge,
  PriorityBadge,
  Spinner,
  EmptyState,
  formatDate,
} from "@/components/ui";

const STATUSES = [
  "new",
  "qualified",
  "queued",
  "contacted",
  "replied",
  "bounced",
  "converted",
  "dead",
  "suppressed",
];
const PRIORITIES = ["hot", "warm", "cool", "cold"];
const LIMIT = 25;

// Not in shared types.ts — the /leads/import endpoint returns a small counts
// object plus an `errors` array of human-readable messages. Numeric fields are
// rendered as badges; `errors` is rendered as a list.
interface LeadImportResult {
  created?: number;
  updated?: number;
  skipped?: number;
  duplicates?: number;
  invalid?: number;
  errors?: string[];
  total?: number;
  imported?: number;
  [k: string]: number | string | string[] | undefined;
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Request failed";
}

function fullName(l: Lead): string {
  const n = [l.first_name, l.last_name].filter(Boolean).join(" ").trim();
  return n || "—";
}

export default function LeadsPage() {
  const { domains, loading: domainsLoading } = useDomains();

  const [domain, setDomain] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);

  const [data, setData] = useState<Paginated<Lead> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [selected, setSelected] = useState<Lead | null>(null);

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<LeadImportResult | null>(null);
  const [importError, setImportError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Monotonic request counter — only the latest fetch's response is applied,
  // so a slow in-flight request can never overwrite a newer one.
  const reqSeq = useRef(0);

  // Seed default domain: first active, else first.
  useEffect(() => {
    if (domain || domains.length === 0) return;
    const active = domains.find((d) => d.is_active) ?? domains[0];
    setDomain(active.slug);
  }, [domains, domain]);

  // Debounce the search box into the actual query. Reset paging in the same
  // update so the filter change and offset reset land together (one fetch).
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput.trim());
      setOffset(0);
    }, 350);
    return () => clearTimeout(t);
  }, [qInput]);

  const fetchLeads = useCallback(() => {
    if (!domain) return;
    const seq = ++reqSeq.current;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      domain,
      limit: String(LIMIT),
      offset: String(offset),
    });
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    if (q) params.set("q", q);
    api
      .get<Paginated<Lead>>(`/leads/?${params.toString()}`)
      .then((res) => {
        if (seq === reqSeq.current) setData(res);
      })
      .catch((e) => {
        if (seq !== reqSeq.current) return;
        setError(errMsg(e));
        setData(null);
      })
      .finally(() => {
        if (seq === reqSeq.current) setLoading(false);
      });
  }, [domain, status, priority, q, offset]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file || !domain) return;
    setImporting(true);
    setImportError("");
    setImportResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api.upload<LeadImportResult>(
        `/leads/import?domain=${encodeURIComponent(domain)}`,
        form
      );
      setImportResult(res);
      setOffset(0);
      fetchLeads();
    } catch (err) {
      setImportError(errMsg(err));
    } finally {
      setImporting(false);
    }
  }

  const total = data?.total ?? 0;
  const items = data?.items ?? [];
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + LIMIT, total);
  const canPrev = offset > 0;
  const canNext = offset + LIMIT < total;

  const importCounts = importResult
    ? Object.entries(importResult).filter(
        ([, v]) => typeof v === "number"
      )
    : [];
  const importErrors: string[] = Array.isArray(importResult?.errors)
    ? importResult.errors
    : [];

  return (
    <div>
      <PageHeader
        title="Leads"
        subtitle="Browse, filter, import and inspect leads per domain."
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={onImportFile}
            />
            <button
              className="btn btn-primary"
              disabled={!domain || importing}
              onClick={() => fileRef.current?.click()}
            >
              {importing ? "Importing…" : "↑ Import CSV"}
            </button>
          </>
        }
      />

      {/* Toolbar */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="label mb-1">Domain</div>
            <DomainSelect
              value={domain}
              onChange={(v) => {
                setDomain(v);
                setOffset(0);
              }}
            />
          </div>
          <div>
            <div className="label mb-1">Status</div>
            <select
              className="input max-w-[180px]"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="label mb-1">Priority</div>
            <select
              className="input max-w-[160px]"
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">All priorities</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <div className="label mb-1">Search</div>
            <input
              className="input"
              placeholder="Email, name, company…"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setQ(qInput.trim());
                  setOffset(0);
                }
              }}
            />
          </div>
        </div>

        {(importResult || importError) && (
          <div className="mt-3 text-sm">
            <div className="flex items-center gap-3 flex-wrap">
              {importError ? (
                <span className="text-rose">Import failed: {importError}</span>
              ) : (
                <>
                  <span className="text-emerald font-medium">Import complete</span>
                  {importCounts.map(([k, v]) => (
                    <span
                      key={k}
                      className="badge text-ink-300"
                      style={{ borderColor: "var(--border)" }}
                    >
                      {k}: {String(v)}
                    </span>
                  ))}
                </>
              )}
              <button
                className="btn btn-ghost ml-auto py-1"
                onClick={() => {
                  setImportResult(null);
                  setImportError("");
                }}
              >
                Dismiss
              </button>
            </div>
            {!importError && importErrors.length > 0 && (
              <ul className="mt-2 space-y-1 list-disc pl-5 text-xs text-rose">
                {importErrors.map((msg, i) => (
                  <li key={i}>{msg}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      {/* Table */}
      <Card className="p-0 overflow-hidden">
        {error && (
          <div className="text-rose text-sm px-5 py-3 border-b border-ink-800">
            {error}
          </div>
        )}

        {loading || domainsLoading ? (
          <Spinner label="Loading leads…" />
        ) : items.length === 0 ? (
          <EmptyState
            title="No leads found"
            hint={
              domain
                ? "Try clearing filters or importing a CSV."
                : "Select a domain to begin."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {["Email", "Name", "Company", "Title", "Status", "Priority", "Score", "Verify"].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-left text-xs uppercase tracking-wide text-ink-400 font-semibold py-2 px-3"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {items.map((l) => (
                  <tr
                    key={l.id}
                    className="border-t border-ink-800 hover:bg-ink-850 cursor-pointer"
                    onClick={() => setSelected(l)}
                  >
                    <td className="py-2 px-3 text-ink-100 font-medium">{l.email}</td>
                    <td className="py-2 px-3 text-ink-300">{fullName(l)}</td>
                    <td className="py-2 px-3 text-ink-300">{l.company || "—"}</td>
                    <td className="py-2 px-3 text-ink-400">{l.title || "—"}</td>
                    <td className="py-2 px-3">
                      <StatusBadge value={l.status} />
                    </td>
                    <td className="py-2 px-3">
                      <PriorityBadge value={l.priority} />
                    </td>
                    <td className="py-2 px-3 text-ink-300">
                      {l.score ?? "—"}
                    </td>
                    <td className="py-2 px-3 text-ink-400">
                      {l.verify_status || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {items.length > 0 && (
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-ink-800">
            <span className="text-xs text-ink-400">
              {start}–{end} of {total}
            </span>
            <div className="flex gap-2">
              <button
                className="btn btn-ghost py-1"
                disabled={!canPrev}
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              >
                ← Prev
              </button>
              <button
                className="btn btn-ghost py-1"
                disabled={!canNext}
                onClick={() => setOffset(offset + LIMIT)}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </Card>

      {selected && (
        <LeadDrawer lead={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

// ── Right-side detail drawer ────────────────────────────────────────────────
function LeadDrawer({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    api
      .get<Message[]>(`/leads/${lead.id}/messages`)
      .then(setMessages)
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [lead.id]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60" onClick={onClose} />
      <aside className="w-full max-w-md h-full overflow-y-auto bg-ink-900 border-l border-ink-700 shadow-2xl">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-ink-800 sticky top-0 bg-ink-900">
          <div>
            <h2 className="text-lg font-bold text-ink-100">{lead.email}</h2>
            <p className="text-sm text-ink-400">{fullName(lead)}</p>
            <div className="flex gap-2 mt-2">
              <StatusBadge value={lead.status} />
              <PriorityBadge value={lead.priority} />
            </div>
          </div>
          <button className="btn btn-ghost py-1" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="p-5 space-y-5">
          <section className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="Company" value={lead.company} />
            <Field label="Title" value={lead.title} />
            <Field label="Industry" value={lead.industry} />
            <Field label="Country" value={lead.country} />
            <Field label="Phone" value={lead.phone} />
            <Field
              label="Employees"
              value={lead.employee_count != null ? String(lead.employee_count) : null}
            />
            <Field label="Segment" value={lead.segment} />
            <Field
              label="Score"
              value={lead.score != null ? String(lead.score) : null}
            />
            <Field label="Source" value={lead.source} />
            <Field
              label="Verify"
              value={
                lead.verify_confidence != null
                  ? `${lead.verify_status} (${lead.verify_confidence})`
                  : lead.verify_status
              }
            />
            <Field label="Follow-ups" value={String(lead.follow_up_count)} />
            <Field label="Last contacted" value={formatDate(lead.last_contacted_at)} />
          </section>

          {(lead.pain_point || lead.hook || lead.notes) && (
            <section className="space-y-3">
              {lead.pain_point && <Block label="Pain point" text={lead.pain_point} />}
              {lead.hook && <Block label="Hook" text={lead.hook} />}
              {lead.notes && <Block label="Notes" text={lead.notes} />}
            </section>
          )}

          {lead.linkedin_url && (
            <a
              href={lead.linkedin_url}
              target="_blank"
              rel="noreferrer"
              className="text-accent text-sm underline break-all"
            >
              {lead.linkedin_url}
            </a>
          )}

          <section>
            <div className="label mb-2">Messages</div>
            {loading ? (
              <Spinner label="Loading messages…" />
            ) : error ? (
              <div className="text-rose text-sm">{error}</div>
            ) : !messages || messages.length === 0 ? (
              <EmptyState title="No messages yet" hint="Nothing has been drafted or sent." />
            ) : (
              <div className="space-y-3">
                {messages.map((m) => (
                  <div key={m.id} className="card-2 p-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs text-ink-400 uppercase tracking-wide">
                        {m.kind}
                      </span>
                      <div className="flex items-center gap-2">
                        <StatusBadge value={m.status} />
                        <span className="text-xs text-ink-400">
                          {formatDate(m.sent_at || m.created_at)}
                        </span>
                      </div>
                    </div>
                    {m.subject && (
                      <div className="text-ink-100 font-medium text-sm mb-1">
                        {m.subject}
                      </div>
                    )}
                    {m.body && (
                      <div className="text-ink-300 text-sm whitespace-pre-wrap">
                        {m.body}
                      </div>
                    )}
                    {m.error && (
                      <div className="text-rose text-xs mt-1">{m.error}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="label mb-0.5">{label}</div>
      <div className="text-sm text-ink-300">{value || "—"}</div>
    </div>
  );
}

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="label mb-1">{label}</div>
      <div className="text-sm text-ink-300 whitespace-pre-wrap">{text}</div>
    </div>
  );
}
