import { describe, expect, it } from 'vitest';
import { AgentService } from '../agents/agent-service.ts';
import { createScope } from '../scope.ts';
import { InMemoryStore } from '../testing/memory-store.ts';

const scopeA = createScope({ workspaceId: 'ws-a', orgId: 'org-a', actorId: 'user-a' });
const scopeB = createScope({ workspaceId: 'ws-b', orgId: 'org-b', actorId: 'user-b' });

describe('AgentService', () => {
  it('upserts and lists status per workspace', async () => {
    const store = new InMemoryStore();
    const service = new AgentService(store);
    await service.setStatus(scopeA, 'rick', 'working', { currentTaskId: 't1' });
    await service.setStatus(scopeA, 'rick', 'online');
    await service.setStatus(scopeB, 'sage', 'idle');
    const rows = await service.listStatus(scopeA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ agent_name: 'rick', status: 'online', current_task_id: null });
  });

  it('records heartbeat events in the scope', async () => {
    const store = new InMemoryStore();
    const service = new AgentService(store);
    await service.recordHeartbeat(scopeA, {
      agentId: 'rick',
      eventType: 'task_completed',
      metadata: { x: 1 },
    });
    expect(store.heartbeatRows[0]).toMatchObject({ workspace_id: 'ws-a', agentId: 'rick' });
  });
});
