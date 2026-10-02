declare const scopeBrand: unique symbol;

/**
 * Tenant scope for every Store call. Only createScope() can produce one, so a
 * raw workspace id string never reaches an adapter by accident.
 */
export interface WorkspaceScope {
  readonly workspaceId: string;
  readonly orgId: string | null;
  readonly actorId: string | null;
  readonly [scopeBrand]: true;
}

export interface WorkspaceScopeInput {
  workspaceId: string;
  orgId?: string | null;
  actorId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createScope(input: WorkspaceScopeInput): WorkspaceScope {
  if (!input.workspaceId || typeof input.workspaceId !== 'string') {
    throw new Error('WorkspaceScope requires a workspaceId');
  }
  return Object.freeze({
    workspaceId: input.workspaceId,
    orgId: input.orgId ?? null,
    actorId: input.actorId ?? null,
  }) as WorkspaceScope;
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
