'use client';

import { useEffect, useState } from 'react';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';

interface CurrentUser {
  id: string | null;
  displayName: string;
  email: string | null;
}

/**
 * Returns the current user's id, display name, and email.
 * Used to replace hardcoded "eric" references across the admin UI.
 */
export function useCurrentUser(): CurrentUser {
  const [user, setUser] = useState<CurrentUser>({
    id: null,
    displayName: 'user',
    email: null,
  });

  useEffect(() => {
    fetchJson<{ id: string; display_name: string | null; email: string | undefined }>(
      apiUrl('/api/user/profile'),
    )
      .then((data) => {
        const name = data.display_name || data.email?.split('@')[0] || 'user';
        setUser({ id: data.id ?? null, displayName: name, email: data.email ?? null });
      })
      .catch(() => {
        // Fallback — keep 'user'
      });
  }, []);

  return user;
}
