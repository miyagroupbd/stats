"use client";

import { useDomains } from "@/lib/hooks";

/** Shared domain <select>. Value is the domain slug. */
export function DomainSelect({
  value,
  onChange,
  includeAll = false,
  className = "",
}: {
  value: string;
  onChange: (slug: string) => void;
  includeAll?: boolean;
  className?: string;
}) {
  const { domains } = useDomains();
  return (
    <select
      className={`input max-w-[220px] ${className}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {includeAll && <option value="">All domains</option>}
      {domains.map((d) => (
        <option key={d.slug} value={d.slug}>
          {d.name} {d.is_active ? "" : "(inactive)"}
        </option>
      ))}
    </select>
  );
}
