"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { Domain } from "@/lib/types";
import {
  Card,
  PageHeader,
  Spinner,
  EmptyState,
} from "@/components/ui";

export default function DomainsPage() {
  const router = useRouter();
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inline create-form state.
  const [showForm, setShowForm] = useState(false);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Domain[]>("/domains/");
      setDomains(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load domains.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const s = slug.trim();
    const n = name.trim();
    if (!s || !n) {
      toast.error("Both slug and name are required.");
      return;
    }
    setCreating(true);
    try {
      const created = await api.post<Domain>("/domains/", { slug: s, name: n });
      toast.success(`Domain "${created.name}" created.`);
      await load();
      router.push(`/domains/${created.slug}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create domain.");
      setCreating(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Domains"
        subtitle="Sending identities and their configuration"
        actions={
          <button
            className={showForm ? "btn btn-ghost" : "btn btn-primary"}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Cancel" : "+ Add domain"}
          </button>
        }
      />

      {showForm && (
        <Card className="mb-6">
          <form onSubmit={handleCreate} className="grid gap-4 md:grid-cols-3 items-end">
            <div>
              <label className="label mb-1.5 block" htmlFor="d-slug">
                Slug
              </label>
              <input
                id="d-slug"
                className="input"
                placeholder="acme-outbound"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="label mb-1.5 block" htmlFor="d-name">
                Name
              </label>
              <input
                id="d-name"
                className="input"
                placeholder="Acme Outbound"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? "Creating…" : "Create domain"}
              </button>
            </div>
          </form>
        </Card>
      )}

      {error && (
        <p className="mb-4 text-sm text-rose">{error}</p>
      )}

      {loading ? (
        <Spinner label="Loading domains…" />
      ) : domains.length === 0 && !error ? (
        <EmptyState
          title="No domains yet"
          hint="Add your first sending domain to start building campaigns."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {domains.map((d) => (
            <Link key={d.id} href={`/domains/${d.slug}`} className="block">
              <div className="card p-5 h-full transition-colors hover:border-ink-600">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink-100 truncate">
                      {d.name}
                    </div>
                    <div className="text-ink-400 text-xs mt-0.5 truncate">
                      {d.slug}
                    </div>
                  </div>
                  <span
                    className="badge shrink-0"
                    style={
                      d.is_active
                        ? {
                            color: "#10b981",
                            borderColor: "#10b98155",
                            background: "#10b98118",
                          }
                        : {
                            color: "#7c8aa8",
                            borderColor: "#7c8aa855",
                            background: "#7c8aa818",
                          }
                    }
                  >
                    {d.is_active ? "active" : "inactive"}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 mt-4">
                  <span
                    className="badge"
                    style={
                      d.smtp_configured
                        ? {
                            color: "#10b981",
                            borderColor: "#10b98155",
                            background: "#10b98118",
                          }
                        : {
                            color: "#f59e0b",
                            borderColor: "#f59e0b55",
                            background: "#f59e0b18",
                          }
                    }
                  >
                    {d.smtp_configured ? "SMTP configured" : "SMTP not set"}
                  </span>
                </div>

                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-ink-400 text-xs uppercase tracking-wide">
                      Model
                    </dt>
                    <dd className="text-ink-300 truncate">{d.model}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-ink-400 text-xs uppercase tracking-wide">
                      Website
                    </dt>
                    <dd className="text-ink-300 truncate">
                      {d.website ? (
                        <span className="text-accent">{d.website}</span>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
