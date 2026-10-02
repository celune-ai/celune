'use client';

import { useState, useEffect } from 'react';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';

type FlagValues = Record<string, boolean | string>;

let flagCache: FlagValues | null = null;
let fetchPromise: Promise<FlagValues> | null = null;

function loadFlags(): Promise<FlagValues> {
  if (flagCache) return Promise.resolve(flagCache);
  if (fetchPromise) return fetchPromise;

  fetchPromise = fetchJson<FlagValues>(apiUrl('/api/flags'))
    .then((data) => {
      flagCache = data;
      fetchPromise = null;
      return data;
    })
    .catch(() => {
      fetchPromise = null;
      return {} as FlagValues;
    });

  return fetchPromise;
}

/**
 * Client-side hook to evaluate feature flags.
 * Fetches flags from /api/flags (server evaluates based on auth context).
 * Caches results for the session.
 */
export function useFlags(): { flags: FlagValues; loading: boolean } {
  const [flags, setFlags] = useState<FlagValues>(flagCache ?? {});
  const [loading, setLoading] = useState(!flagCache);

  useEffect(() => {
    loadFlags().then((data) => {
      setFlags(data);
      setLoading(false);
    });
  }, []);

  return { flags, loading };
}

/**
 * Check a single boolean flag.
 */
export function useFlag(key: string): { enabled: boolean; loading: boolean } {
  const { flags, loading } = useFlags();
  return { enabled: flags[key] === true, loading };
}
