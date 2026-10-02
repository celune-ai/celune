import type { AgentStatus } from '@repo/types';
import type { WorkspaceScope } from '../scope.ts';
import type { AgentRunState, HeartbeatEventInput, Store } from '../store.ts';

export class AgentService {
  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  setStatus(
    scope: WorkspaceScope,
    agentName: string,
    status: AgentRunState,
    options: { currentTaskId?: string | null; userId?: string | null } = {},
  ): Promise<void> {
    return this.store.agents.upsertStatus(scope, {
      agentName,
      status,
      currentTaskId: options.currentTaskId ?? null,
      userId: options.userId ?? null,
    });
  }

  listStatus(scope: WorkspaceScope): Promise<AgentStatus[]> {
    return this.store.agents.listStatus(scope);
  }

  recordHeartbeat(scope: WorkspaceScope, input: HeartbeatEventInput): Promise<void> {
    return this.store.agents.appendHeartbeat(scope, input);
  }
}
