import type { ActorContext, Services, WorkspaceScope } from '@celuneai/core';
import type { AuthContext } from '../auth/types.ts';
import type { ApiHost } from '../host.ts';

/** Request-scoped values every route reads from `c.var`. */
export type ApiEnv = {
  Variables: {
    auth: AuthContext;
    services: Services;
    host: ApiHost;
    scope: WorkspaceScope;
    actor: ActorContext;
    /** Set on every request; echoed in the x-request-id response header. */
    requestId: string;
  };
};
