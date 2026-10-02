import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActorContext } from '../actor.ts';
import {
  GateDenied,
  InvalidTransition,
  NotFound,
  TaskBlocked,
  ValidationError,
} from '../errors.ts';
import type { Gate } from '../gate.ts';
import { createScope } from '../scope.ts';
import { TaskService, mergeDescription } from '../tasks/task-service.ts';
import { InMemoryStore } from '../testing/memory-store.ts';

const scopeA = createScope({ workspaceId: 'ws-a', orgId: 'org-a', actorId: 'user-a' });
const scopeB = createScope({ workspaceId: 'ws-b', orgId: 'org-b', actorId: 'user-b' });
const web: ActorContext = { source: 'web', userId: 'user-a' };
const cli: ActorContext = { source: 'task-cli', ownerUserId: 'owner-1' };

let store: InMemoryStore;
let service: TaskService;
const clock = () => new Date('2026-09-26T12:00:00.000Z');

beforeEach(() => {
  store = new InMemoryStore({ clock });
  service = new TaskService(store, { clock });
});

describe('TaskService.create', () => {
  it('creates a task in the scope and logs task.created', async () => {
    const task = await service.create(scopeA, { title: 'Ship it' }, web);
    expect(task.workspace_id).toBe('ws-a');
    expect(task.status).toBe('inbox');
    const activity = store.activityRows.find((a) => a.event_type === 'task.created');
    expect(activity?.title).toBe('Task created: Ship it');
    expect(activity?.workspace_id).toBe('ws-a');
    expect(activity?.actor_user_id).toBe('user-a');
  });

  it('checks the gate with task.create', async () => {
    const gate: Gate = { check: vi.fn(async () => ({ allowed: true }) as const) };
    const gated = new TaskService(store, { gate, clock });
    await gated.create(scopeA, { title: 'x' }, web);
    expect(gate.check).toHaveBeenCalledWith('task.create', { scope: scopeA, userId: 'user-a' });
  });

  it('throws GateDenied and writes nothing when the gate refuses', async () => {
    const gate: Gate = {
      check: async () => ({
        allowed: false,
        reason: 'plan_limit',
        status: 403,
        upgradeUrl: '/billing',
      }),
    };
    const gated = new TaskService(store, { gate, clock });
    await expect(gated.create(scopeA, { title: 'x' }, web)).rejects.toBeInstanceOf(GateDenied);
    expect(store.taskRows.size).toBe(0);
    expect(store.activityRows).toHaveLength(0);
  });

  it('logs task.spawned for child tasks and refuses deep nesting', async () => {
    const parent = store.seedTask(scopeA, { title: 'parent' });
    const child = await service.create(scopeA, { title: 'child', parent_id: parent.id }, web);
    expect(store.activityRows[0]?.event_type).toBe('task.spawned');
    await expect(
      service.create(scopeA, { title: 'grandchild', parent_id: child.id }, web),
    ).rejects.toThrow('Cannot nest deeper than one level');
  });

  it('logs task.follow_up when spawned_by is a task id', async () => {
    const origin = store.seedTask(scopeA, { title: 'origin' });
    await service.create(scopeA, { title: 'next', spawned_by: origin.id, assignee: 'rick' }, web);
    const activity = store.activityRows[0];
    expect(activity?.event_type).toBe('task.follow_up');
    expect(activity?.source).toBe('follow-up');
    expect(activity?.agent_id).toBe('rick');
  });

  it('validates dependencies on create', async () => {
    await expect(
      service.create(
        scopeA,
        { title: 'x', depends_on: ['00000000-0000-4000-8000-000000000000'] },
        web,
      ),
    ).rejects.toThrow(/Dependency not found/);
  });

  it('rejects unknown statuses', async () => {
    await expect(
      service.create(scopeA, { title: 'x', status: 'blocked' as never }, web),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('cannot read a parent from another workspace', async () => {
    const foreign = store.seedTask(scopeB, { title: 'foreign' });
    await expect(
      service.create(scopeA, { title: 'child', parent_id: foreign.id }, web),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it('rejects a project, follow-up origin, or dependency from another workspace', async () => {
    const foreignProject = store.seedProject(scopeB, { name: 'theirs' });
    const foreignTask = store.seedTask(scopeB, { title: 'foreign' });
    await expect(
      service.create(scopeA, { title: 'x', project_id: foreignProject.id }, web),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      service.create(scopeA, { title: 'x', spawned_by: foreignTask.id }, web),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      service.create(scopeA, { title: 'x', depends_on: [foreignTask.id] }, web),
    ).rejects.toMatchObject({ status: 404 });
    expect([...store.taskRows.values()].filter((t) => t.workspace_id === 'ws-a')).toHaveLength(0);
  });

  it('accepts a project from the same workspace', async () => {
    const project = store.seedProject(scopeA, { name: 'ours' });
    const task = await service.create(scopeA, { title: 'x', project_id: project.id }, web);
    expect(task.project_id).toBe(project.id);
  });
});

describe('TaskService.update cross-workspace references', () => {
  it('rejects moving a task into a project or under a parent from another workspace', async () => {
    const task = store.seedTask(scopeA, { title: 'mine' });
    const foreignProject = store.seedProject(scopeB, { name: 'theirs' });
    const foreignTask = store.seedTask(scopeB, { title: 'foreign' });
    await expect(
      service.update(scopeA, task.id, { project_id: foreignProject.id }, web),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      service.update(scopeA, task.id, { parent_id: foreignTask.id }, web),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      service.update(scopeA, task.id, { spawned_by: foreignTask.id }, web),
    ).rejects.toBeInstanceOf(NotFound);
    const after = await service.get(scopeA, task.id);
    expect(after.project_id ?? null).toBeNull();
    expect(after.parent_id ?? null).toBeNull();
  });

  it('rejects a task as its own parent and allows clearing the project', async () => {
    const project = store.seedProject(scopeA, { name: 'ours' });
    const task = store.seedTask(scopeA, { title: 'mine', project_id: project.id });
    await expect(
      service.update(scopeA, task.id, { parent_id: task.id }, web),
    ).rejects.toBeInstanceOf(ValidationError);
    const { task: cleared } = await service.update(scopeA, task.id, { project_id: null }, web);
    expect(cleared.project_id).toBeNull();
  });
});

describe('TaskService.update', () => {
  it('applies a valid transition, stamps piv_stage, and logs the change', async () => {
    const task = store.seedTask(scopeA, { title: 't', status: 'planning' });
    const result = await service.update(scopeA, task.id, { status: 'in_progress' }, web);
    expect(result.statusChanged).toBe(true);
    expect(result.task.status).toBe('in_progress');
    expect(result.task.metadata).toMatchObject({
      piv_stage: 'implement',
      piv_implement_at: '2026-09-26T12:00:00.000Z',
    });
    const activity = store.activityRows.find((a) => a.event_type === 'task.updated');
    expect(activity?.title).toBe('Task status changed: planning → in_progress');
  });

  it('ignores scope keys in a patch', async () => {
    const task = store.seedTask(scopeA, { title: 't', status: 'planning' });
    const patch = { title: 'renamed', workspace_id: 'ws-b', org_id: 'org-b', id: 'other' };
    await service.update(scopeA, task.id, patch as never, web);
    expect(store.taskRows.get(task.id)).toMatchObject({
      id: task.id,
      title: 'renamed',
      workspace_id: 'ws-a',
    });
    expect(store.taskRows.has('other')).toBe(false);
  });

  it('rejects an invalid transition and writes nothing', async () => {
    const task = store.seedTask(scopeA, { title: 't', status: 'backlog' });
    await expect(
      service.update(scopeA, task.id, { status: 'done', title: 'changed' }, web),
    ).rejects.toBeInstanceOf(InvalidTransition);
    expect(store.taskRows.get(task.id)?.title).toBe('t');
    expect(store.taskRows.get(task.id)?.status).toBe('backlog');
    expect(store.activityRows).toHaveLength(0);
  });

  it('treats a same-status patch as a plain update', async () => {
    const task = store.seedTask(scopeA, { title: 't', status: 'review' });
    const result = await service.update(
      scopeA,
      task.id,
      { status: 'review', priority: 'high' },
      web,
    );
    expect(result.statusChanged).toBe(false);
    expect(result.task.priority).toBe('high');
    expect(store.activityRows).toHaveLength(0);
  });

  it('clears the session, stamps completion, and resets the claimer on done', async () => {
    const task = store.seedTask(scopeA, {
      title: 't',
      status: 'in_progress',
      assignee: 'rick',
      metadata: { claimed_by: 'rick', active_session: true },
    });
    const result = await service.update(scopeA, task.id, { status: 'done' }, web);
    expect(result.completed).toBe(true);
    expect(result.task.completed_at).toBe('2026-09-26T12:00:00.000Z');
    expect(result.task.metadata).toMatchObject({
      active_session: false,
      completed_by: 'rick',
      work_completed_at: '2026-09-26T12:00:00.000Z',
      piv_stage: 'validate',
    });
    const agent = store.agentRows.get('ws-a:rick');
    expect(agent?.status).toBe('online');
    expect(agent?.current_task_id).toBeNull();
    expect(store.heartbeatRows[0]).toMatchObject({ agentId: 'rick', eventType: 'task_completed' });
  });

  it('preserves an existing description when replaced', async () => {
    const task = store.seedTask(scopeA, { title: 't', description: 'old text' });
    const result = await service.update(scopeA, task.id, { description: 'new text' }, web);
    expect(result.task.description).toBe('new text\n\n---\n\n*Previous description:*\n\nold text');
    const cleared = await service.update(scopeA, task.id, { description: '' }, web);
    expect(cleared.task.description).toBe(result.task.description);
  });

  it('validates depends_on on update', async () => {
    const a = store.seedTask(scopeA, { title: 'a' });
    await expect(service.update(scopeA, a.id, { depends_on: [a.id] }, web)).rejects.toThrow(
      'A task cannot depend on itself',
    );
  });

  it('cannot update a task in another workspace', async () => {
    const foreign = store.seedTask(scopeB, { title: 'foreign' });
    await expect(service.update(scopeA, foreign.id, { title: 'x' }, web)).rejects.toBeInstanceOf(
      NotFound,
    );
    expect(store.taskRows.get(foreign.id)?.title).toBe('foreign');
  });
});

describe('TaskService.updateStatus', () => {
  it('routes through the validator', async () => {
    const task = store.seedTask(scopeA, { title: 't', status: 'in_progress' });
    const result = await service.updateStatus(scopeA, task.id, 'review', web);
    expect(result.task.status).toBe('review');
    await expect(service.updateStatus(scopeA, task.id, 'backlog', web)).rejects.toBeInstanceOf(
      InvalidTransition,
    );
  });
});

describe('TaskService.claim', () => {
  it('claims a planned task, marks the agent working, and logs task.claimed', async () => {
    const task = store.seedTask(scopeA, { title: 't', status: 'planning' });
    const claimed = await service.claim(scopeA, task.id, 'rick', cli);
    expect(claimed.status).toBe('in_progress');
    expect(claimed.assignee).toBe('rick');
    expect(claimed.metadata).toMatchObject({
      active_session: true,
      claimed_by: 'rick',
      claimed_at: '2026-09-26T12:00:00.000Z',
    });
    expect(store.agentRows.get('ws-a:rick')).toMatchObject({
      status: 'working',
      current_task_id: task.id,
    });
    const activity = store.activityRows.find((a) => a.event_type === 'task.claimed');
    expect(activity?.title).toBe('rick claimed: t');
    expect(activity?.user_id).toBe('owner-1');
  });

  it('walks an inbox task through planning first, logging both hops', async () => {
    const task = store.seedTask(scopeA, { title: 't', status: 'inbox' });
    const claimed = await service.claim(scopeA, task.id, 'rick', cli);
    expect(claimed.status).toBe('in_progress');
    const events = store.activityRows.map((a) => a.event_type);
    expect(events).toEqual(['task.updated', 'task.claimed']);
    expect(store.activityRows[0]?.details).toMatchObject({
      previous_status: 'inbox',
      new_status: 'planning',
    });
  });

  it('refuses a blocked task', async () => {
    const task = store.seedTask(scopeA, {
      title: 't',
      status: 'planning',
      metadata: { blocked: true, blocked_reason: 'waiting on API' },
    });
    await expect(service.claim(scopeA, task.id, 'rick', cli)).rejects.toBeInstanceOf(TaskBlocked);
    expect(store.taskRows.get(task.id)?.status).toBe('planning');
  });

  it('refuses an archived task', async () => {
    const task = store.seedTask(scopeA, { title: 't', status: 'archived' as never });
    await expect(service.claim(scopeA, task.id, 'rick', cli)).rejects.toBeInstanceOf(
      InvalidTransition,
    );
  });

  it('records delegation when the assignee changes', async () => {
    const task = store.seedTask(scopeA, { title: 't', status: 'planning', assignee: 'sage' });
    const claimed = await service.claim(scopeA, task.id, 'rick', cli);
    expect(claimed.metadata).toMatchObject({ delegated_by: 'sage' });
  });
});

describe('TaskService.complete', () => {
  it('moves to done, stores the outcome in memory, and frees the agent', async () => {
    const task = store.seedTask(scopeA, {
      title: 't',
      status: 'in_progress',
      metadata: { claimed_by: 'rick', active_session: true },
    });
    const done = await service.complete(
      scopeA,
      task.id,
      { agentId: 'rick', outcome: '  Shipped  ' },
      cli,
    );
    expect(done.status).toBe('done');
    expect(done.outcome).toBe('Shipped');
    expect(done.metadata).toMatchObject({ completed_by: 'rick', active_session: false });
    expect(store.memoryRows[0]).toMatchObject({
      taskId: task.id,
      outcome: 'Shipped',
      workspace_id: 'ws-a',
      source: 'task-cli',
    });
    expect(store.agentRows.get('ws-a:rick')?.status).toBe('online');
    expect(store.activityRows.find((a) => a.event_type === 'task.completed')?.title).toBe(
      'rick completed: t',
    );
  });

  it('completes the task when the outcome memory write fails', async () => {
    const task = store.seedTask(scopeA, { title: 't', status: 'review' });
    vi.spyOn(store.memory, 'storeOutcome').mockRejectedValueOnce(new Error('quota exceeded'));
    const done = await service.complete(scopeA, task.id, { outcome: 'x' }, web);
    expect(done.status).toBe('done');
  });

  it('skips the memory write without an outcome', async () => {
    const task = store.seedTask(scopeA, { title: 't', status: 'review' });
    await service.complete(scopeA, task.id, {}, web);
    expect(store.memoryRows).toHaveLength(0);
  });

  it('refuses to complete from backlog', async () => {
    const task = store.seedTask(scopeA, { title: 't', status: 'backlog' });
    await expect(service.complete(scopeA, task.id, { outcome: 'x' }, web)).rejects.toBeInstanceOf(
      InvalidTransition,
    );
    expect(store.memoryRows).toHaveLength(0);
  });
});

describe('TaskService.block / unblock', () => {
  it('sets and clears blocked metadata with activity rows', async () => {
    const task = store.seedTask(scopeA, {
      title: 't',
      status: 'in_progress',
      metadata: { claimed_by: 'rick' },
    });
    const blocked = await service.block(
      scopeA,
      task.id,
      { reason: 'waiting', agentId: 'rick' },
      cli,
    );
    expect(blocked.metadata).toMatchObject({
      blocked: true,
      blocked_reason: 'waiting',
      blocked_by: 'rick',
      claimed_by: 'rick',
    });
    expect(blocked.status).toBe('in_progress');
    const unblocked = await service.unblock(scopeA, task.id, cli);
    expect(unblocked.metadata).not.toHaveProperty('blocked');
    expect(unblocked.metadata).not.toHaveProperty('blocked_reason');
    expect(unblocked.metadata).toMatchObject({ claimed_by: 'rick' });
    expect(store.activityRows.map((a) => a.event_type)).toEqual(['task.blocked', 'task.unblocked']);
  });
});

describe('TaskService.addComment', () => {
  it('adds a scoped comment and logs it', async () => {
    const task = store.seedTask(scopeA, { title: 't' });
    const comment = await service.addComment(
      scopeA,
      task.id,
      { author: 'rick', content: 'hi' },
      web,
    );
    expect(comment.task_id).toBe(task.id);
    expect(comment.user_id).toBe('user-a');
    expect(store.activityRows[0]).toMatchObject({ event_type: 'task.commented', task_id: task.id });
  });

  it('refuses a task outside the scope', async () => {
    const foreign = store.seedTask(scopeB, { title: 'f' });
    await expect(
      service.addComment(scopeA, foreign.id, { author: 'rick', content: 'hi' }, web),
    ).rejects.toBeInstanceOf(NotFound);
    expect(store.commentRows).toHaveLength(0);
  });
});

describe('TaskService.delete', () => {
  it('logs then deletes', async () => {
    const task = store.seedTask(scopeA, { title: 't', metadata: { claimed_by: 'rick' } });
    await service.delete(scopeA, task.id, web);
    expect(store.taskRows.has(task.id)).toBe(false);
    expect(store.activityRows[0]).toMatchObject({ event_type: 'task.deleted', agent_id: 'rick' });
  });
});

describe('TaskService.list', () => {
  it('only returns tasks from the scope', async () => {
    store.seedTask(scopeA, { title: 'a' });
    store.seedTask(scopeB, { title: 'b' });
    const rows = await service.list(scopeA);
    expect(rows.map((t) => t.title)).toEqual(['a']);
  });
});

describe('mergeDescription', () => {
  it('returns incoming when there is no prior content', () => {
    expect(mergeDescription(null, 'new')).toBe('new');
  });
  it('keeps the old description when the new one already contains it', () => {
    expect(mergeDescription('old', 'old plus more')).toBe('old plus more');
  });
  it('refuses to clear existing content', () => {
    expect(mergeDescription('old', '')).toBeUndefined();
  });
});
