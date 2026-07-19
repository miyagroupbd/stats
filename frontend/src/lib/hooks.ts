"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import type { Domain } from "./types";

// Module-level cache so /domains/ is fetched once and shared across every
// DomainSelect that mounts, instead of one request per hook consumer.
let domainsCache: Domain[] | null = null;
let domainsInflight: Promise<Domain[]> | null = null;

function loadDomains(): Promise<Domain[]> {
  if (domainsCache) return Promise.resolve(domainsCache);
  if (!domainsInflight) {
    domainsInflight = api
      .get<Domain[]>("/domains/")
      .then((d) => {
        domainsCache = d;
        return d;
      })
      .catch(() => {
        // Reset so a later mount can retry the failed fetch.
        domainsInflight = null;
        return [] as Domain[];
      });
  }
  return domainsInflight;
}

/** Fetch all domains once; shared by pages that need a domain selector. */
export function useDomains() {
  const [domains, setDomains] = useState<Domain[]>(domainsCache ?? []);
  const [loading, setLoading] = useState(domainsCache === null);
  useEffect(() => {
    if (domainsCache) {
      setDomains(domainsCache);
      setLoading(false);
      return;
    }
    let active = true;
    loadDomains()
      .then((d) => {
        if (active) setDomains(d);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return { domains, loading };
}
