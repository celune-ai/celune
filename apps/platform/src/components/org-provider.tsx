'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { apiUrl } from '@repo/db/api';

const ORG_COOKIE = 'active-org';

type OrgContextValue = {
  orgId: string | null;
};

const OrgContext = createContext<OrgContextValue>({ orgId: null });

export function useOrg(): OrgContextValue {
  return useContext(OrgContext);
}

/**
 * Fetches the user's current org_id from /api/user/role and persists it in the
 * `active-org` cookie so middleware can forward it as an x-org-id request header.
 * Falls back gracefully when unauthenticated or on fetch error.
 */
export function OrgProvider({ children }: { children: React.ReactNode }) {
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    async function syncOrg() {
      try {
        const res = await fetch(apiUrl('/api/user/role'));
        if (!res.ok) return;
        const data = (await res.json()) as { org_id?: string | null };
        const id = data.org_id ?? null;
        setOrgId(id);

        if (id) {
          document.cookie = `${ORG_COOKIE}=${id}; path=/; SameSite=Lax`;
        } else {
          // Clear cookie when no org (null org_id = single-org / default context)
          document.cookie = `${ORG_COOKIE}=; path=/; Max-Age=0`;
        }
      } catch {
        // Network or parse error — leave cookie as-is
      }
    }

    void syncOrg();
  }, []);

  const value = useMemo(() => ({ orgId }), [orgId]);

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}
