"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { confirmToast } from "@/lib/toast";
import type { Campaign } from "@/lib/types";
import { useDomains } from "@/lib/hooks";
import { DomainSelect } from "@/components/DomainSelect";
import {
  Card,
  PageHeader,
  StatusBadge,
  Spinner,
  EmptyState,
  formatDate,
} from "@/components/ui";

export default function CampaignsPage() {
  const { domains, loading: domainsLoading } = useDomains();
  const [slug, setSlug] = useState("");

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New-campaign inline form.
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Seed the selected domain with the first active one (fall back to first).
  useEffect(() => {
    if (slug || domains.length === 0) return;
    const first = domains.find((d) => d.is_active) ?? domains[0];
    setSlug(first.slug);
  }, [domains, slug]);

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Campaign[]>(
        `/campaigns/?domain=${encodeURIComponent(slug)}`
      );
      setCampaigns(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load campaigns.");
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  // Refetch whenever the selected domain changes.
  useEffect(() => {
    load();
  }, [load]);

  function onChangeDomain(next: string) {
    setSlug(next);
    setShowForm(false);
  }

  async function createCampaign(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !slug) return;
    setSaving(true);
    try {
      const created = await api.post<Campaign>(
        `/campaigns/?domain=${encodeURIComponent(slug)}`,
        { name: name.trim(), description: description.trim() || undefined }
      );
      setName("");
      setDescription("");
      setShowForm(false);
      toast.success(`Campaign "${created.name}" created.`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to create campaign.");
    } finally {
      setSaving(false);
    }
  }

  function deleteCampaign(c: Campaign) {
    confirmToast({
      title: `Delete campaign "${c.name}"?`,
      description: "This cannot be undone.",
      confirmLabel: "Delete",
      onConfirm: () => performDelete(c),
    });
  }

  async function performDelete(c: Campaign) {
    setDeletingId(c.id);
    try {
      await api.del(`/campaigns/${c.id}`);
      setCampaigns((prev) => prev.filter((x) => x.id !== c.id));
      toast.success(`Campaign "${c.name}" deleted.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to delete campaign.");
    } finally {
      setDeletingId(null);
    }
  }

  const noDomains = !domainsLoading && domains.length === 0;

  return (
    <div>
      <PageHeader
        title="Campaigns"
        subtitle="Group leads and outreach by initiative, per sending domain."
        actions={
          <>
            <DomainSelect value={slug} onChange={onChangeDomain} />
            <button
              className="btn btn-primary"
              disabled={!slug}
              onClick={() => setShowForm((v) => !v)}
            >
              {showForm ? "Close" : "+ New campaign"}
            </button>
          </>
        }
      />

      {error && (
        <div className="mb-4 text-sm text-rose border border-rose/40 bg-rose/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {showForm && (
        <Card className="mb-5">
          <form onSubmit={createCampaign} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-1">
              <label className="label block mb-1.5">Name</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Q3 Outbound — SaaS founders"
                autoFocus
                required
              />
            </div>
            <div className="sm:col-span-1">
              <label className="label block mb-1.5">Description</label>
              <input
                className="input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional — goal, ICP, notes"
              />
            </div>
            <div className="sm:col-span-2 flex gap-2">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving || !name.trim()}
              >
                {saving ? "Creating…" : "Create campaign"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card className="!p-0 overflow-hidden">
        {noDomains ? (
          <EmptyState
            title="No domains yet"
            hint="Add a sending domain before creating campaigns."
          />
        ) : loading || domainsLoading ? (
          <Spinner label="Loading campaigns…" />
        ) : campaigns.length === 0 ? (
          <EmptyState
            title="No campaigns for this domain"
            hint="Use “+ New campaign” to create your first one."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left text-xs uppercase tracking-wide text-ink-400 font-semibold py-2 px-3">
                    Name
                  </th>
                  <th className="text-left text-xs uppercase tracking-wide text-ink-400 font-semibold py-2 px-3">
                    Status
                  </th>
                  <th className="text-left text-xs uppercase tracking-wide text-ink-400 font-semibold py-2 px-3">
                    Leads
                  </th>
                  <th className="text-left text-xs uppercase tracking-wide text-ink-400 font-semibold py-2 px-3">
                    Description
                  </th>
                  <th className="text-left text-xs uppercase tracking-wide text-ink-400 font-semibold py-2 px-3">
                    Created
                  </th>
                  <th className="text-right text-xs uppercase tracking-wide text-ink-400 font-semibold py-2 px-3">
                    &nbsp;
                  </th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-t border-ink-800 hover:bg-ink-850">
                    <td className="py-2.5 px-3 font-medium text-ink-100">
                      {c.name}
                    </td>
                    <td className="py-2.5 px-3">
                      <StatusBadge value={c.status} />
                    </td>
                    <td className="py-2.5 px-3 text-ink-300 tabular-nums">
                      {c.lead_count ?? 0}
                    </td>
                    <td className="py-2.5 px-3 text-ink-400 max-w-[28rem] truncate">
                      {c.description || "—"}
                    </td>
                    <td className="py-2.5 px-3 text-ink-400 whitespace-nowrap">
                      {formatDate(c.created_at)}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        className="btn btn-ghost !py-1 !px-2 text-xs text-rose"
                        disabled={deletingId === c.id}
                        onClick={() => deleteCampaign(c)}
                      >
                        {deletingId === c.id ? "Deleting…" : "Delete"}
                      </button>
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
