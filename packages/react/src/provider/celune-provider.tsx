'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRestTransport } from '../transport/rest';
import { isAuthError, type CeluneTransport, type SubscribeFn } from '../transport/types';
import {
  CeluneContext,
  type CeluneContextValue,
  type CeluneCurrentUser,
  type CeluneSlots,
  type ConnectionStatus,
  type LinkComponent,
  type LinkProps,
} from './context';
import { ReconnectBanner } from './reconnect-banner';
import {
  buildAppearanceCss,
  CeluneElementsContext,
  type CeluneAppearance,
  type CeluneElements,
} from './appearance';

export const DEFAULT_POLL_INTERVAL = 15_000;

export interface CeluneProviderProps {
  /** Base URL of the @celuneai/api mount. Used by the default REST transport. */
  apiUrl: string;
  /** Current bearer token. */
  token: string | null;
  /** Returns a fresh token. Rejecting or returning null switches the UI to read-only. */
  refreshToken?: () => Promise<string | null>;
  /** Realtime adapter. Without it, data hooks poll every `pollInterval` ms. */
  subscribe?: SubscribeFn;
  /** Link component used for every in-app link (for example next/link). Defaults to `<a>`. */
  Link?: LinkComponent;
  workspaceId: string;
  /** Replaces the default REST transport. Auth retry and read-only handling still apply. */
  transport?: CeluneTransport;
  pollInterval?: number;
  /** Builds an in-app href from a module path such as `/tasks?task=id`. Defaults to identity. */
  href?: (path: string) => string;
  /** False renders every module read-only (for example a viewer role). */
  canEdit?: boolean;
  currentUser?: CeluneCurrentUser;
  slots?: CeluneSlots;
  onMigrationIssue?: () => void;
  /** Share the host's react-query cache. A private client is created when omitted. */
  queryClient?: QueryClient;
  /** Replaces the default reconnect prompt. */
  renderReconnect?: (reconnect: () => Promise<boolean>) => ReactNode;
  /** Theme base, `--celune-*` values, and per-part class overrides. */
  appearance?: CeluneAppearance;
  children: ReactNode;
}

function AnchorLink({ href, children, ...rest }: LinkProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

const identity = (path: string) => path;
const DEFAULT_USER: CeluneCurrentUser = { displayName: 'user' };
const NO_SLOTS: CeluneSlots = {};
const NO_ELEMENTS: CeluneElements = {};

type AnyFn = (...args: unknown[]) => Promise<unknown>;

/** Wraps every transport method: on a 401, refresh the token once and retry. */
function withAuthRetry<T extends object>(target: T, refresh: () => Promise<boolean>): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(target)) {
    if (typeof value === 'function') {
      const fn = value as AnyFn;
      out[key] = async (...args: unknown[]) => {
        try {
          return await fn.apply(target, args);
        } catch (err) {
          if (!isAuthError(err)) throw err;
          if (!(await refresh())) throw err;
          return fn.apply(target, args);
        }
      };
    } else if (value && typeof value === 'object') {
      out[key] = withAuthRetry(value as object, refresh);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

export function CeluneProvider({
  apiUrl,
  token,
  refreshToken,
  subscribe,
  Link = AnchorLink,
  workspaceId,
  transport: customTransport,
  pollInterval = DEFAULT_POLL_INTERVAL,
  href = identity,
  canEdit = true,
  currentUser = DEFAULT_USER,
  slots = NO_SLOTS,
  onMigrationIssue,
  queryClient,
  renderReconnect,
  appearance,
  children,
}: CeluneProviderProps) {
  const tokenRef = useRef<string | null>(token);
  const [connection, setConnection] = useState<ConnectionStatus>('connected');
  const inflight = useRef<Promise<boolean> | null>(null);
  const refreshRef = useRef(refreshToken);
  refreshRef.current = refreshToken;

  useEffect(() => {
    tokenRef.current = token;
    if (token) setConnection('connected');
  }, [token]);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (inflight.current) return inflight.current;
    const run = async () => {
      const fn = refreshRef.current;
      if (!fn) {
        setConnection('read-only');
        return false;
      }
      setConnection('refreshing');
      try {
        const next = await fn();
        if (!next) throw new Error('empty token');
        tokenRef.current = next;
        setConnection('connected');
        return true;
      } catch {
        setConnection('read-only');
        return false;
      }
    };
    inflight.current = run().finally(() => {
      inflight.current = null;
    });
    return inflight.current;
  }, []);

  const transport = useMemo(() => {
    const base =
      customTransport ??
      createRestTransport({ apiUrl, getToken: () => tokenRef.current, workspaceId });
    return withAuthRetry(base, refresh);
  }, [customTransport, apiUrl, workspaceId, refresh]);

  const [ownClient] = useState(() => queryClient ?? new QueryClient());
  const client = queryClient ?? ownClient;

  const value = useMemo<CeluneContextValue>(
    () => ({
      transport,
      workspaceId,
      subscribe,
      pollInterval,
      Link,
      href,
      canEdit: canEdit && connection !== 'read-only',
      connection,
      reconnect: refresh,
      currentUser,
      slots,
      onMigrationIssue,
    }),
    [
      transport,
      workspaceId,
      subscribe,
      pollInterval,
      Link,
      href,
      canEdit,
      connection,
      refresh,
      currentUser,
      slots,
      onMigrationIssue,
    ],
  );

  const theme = appearance?.theme ?? 'auto';
  const appearanceCss = useMemo(
    () => buildAppearanceCss(appearance?.variables),
    [appearance?.variables],
  );
  const elements = appearance?.elements ?? NO_ELEMENTS;

  return (
    <QueryClientProvider client={client}>
      <CeluneContext.Provider value={value}>
        <CeluneElementsContext.Provider value={elements}>
          <div
            className="celune-root"
            data-celune-theme={theme === 'auto' ? undefined : theme}
            style={{ display: 'contents' }}
          >
            {appearanceCss && <style data-celune-appearance="">{appearanceCss}</style>}
            {connection === 'read-only' &&
              (renderReconnect ? (
                renderReconnect(refresh)
              ) : (
                <ReconnectBanner onReconnect={refresh} />
              ))}
            {children}
          </div>
        </CeluneElementsContext.Provider>
      </CeluneContext.Provider>
    </QueryClientProvider>
  );
}
