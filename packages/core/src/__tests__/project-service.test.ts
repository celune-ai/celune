import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActorContext } from '../actor.ts';
import { GateDenied, NotFound } from '../errors.ts';
import type { Gate } from '../gate.ts';
import { ProjectService } from '../projects/project-service.ts';
import { createScope } from '../scope.ts';
import { InMemoryStore } from '../testing/memory-store.ts';

const scopeA = createScope({ workspaceId: 'ws-a', orgId: 'org-a', actorId: 'user-a' });
const scopeB = createScope({ workspaceId: 'ws-b', orgId: 'org-b', actorId: 'user-b' });
const web: ActorContext = { source: 'web', userId: 'user-a' };

let store: InMemoryStore;
let service: ProjectService;

beforeEach(() => {
  store = new InMemoryStore();
  service = new ProjectService(store);
});

describe('ProjectService.create', () => {
  it('creates a project, dedupes the name, and logs project.created', async () => {
    store.seedProject(scopeA, { name: 'Launch' });
    const project = await service.create(scopeA, { name: 'Launch' }, web);
    expect(project.name).toBe('Launch v2');
    expect(project.workspace_id).toBe('ws-a');
    expect(store.activityRows[0]).toMatchObject({
      event_type: 'project.created',
      title: 'Project created: Launch v2',
    });
  });

  it('ignores names taken in another workspace', async () => {
    store.seedProject(scopeB, { name: 'Launch' });
    const project = await service.create(scopeA, { name: 'Launch' }, web);
    expect(project.name).toBe('Launch');
  });

  it('checks the gate with project.create', async () => {
    const gate: Gate = { check: vi.fn(async () => ({ allowed: true }) as const) };
    const gated = new ProjectService(store, { gate });
    await gated.create(scopeA, { name: 'x' }, web);
    expect(gate.check).toHaveBeenCalledWith('project.create', { scope: scopeA, userId: 'user-a' });
  });

  it('throws GateDenied when refused', async () => {
    const gate: Gate = {
      check: async () => ({ allowed: false, reason: 'plan_limit', status: 403 }),
    };
    const gated = new ProjectService(store, { gate });
    await expect(gated.create(scopeA, { name: 'x' }, web)).rejects.toBeInstanceOf(GateDenied);
    expect(store.projectRows.size).toBe(0);
  });
});

describe('ProjectService.update', () => {
  it('dedupes a renamed project against others but not itself', async () => {
    const p1 = store.seedProject(scopeA, { name: 'Alpha' });
    store.seedProject(scopeA, { name: 'Beta' });
    const same = await service.update(scopeA, p1.id, { name: 'Alpha' }, web);
    expect(same.name).toBe('Alpha');
    const clash = await service.update(scopeA, p1.id, { name: 'Beta' }, web);
    expect(clash.name).toBe('Beta v2');
    expect(store.activityRows.every((a) => a.event_type === 'project.updated')).toBe(true);
  });

  it('refuses a project from another workspace', async () => {
    const foreign = store.seedProject(scopeB, { name: 'x' });
    await expect(service.update(scopeA, foreign.id, { name: 'y' }, web)).rejects.toBeInstanceOf(
      NotFound,
    );
  });
});

describe('ProjectService.delete', () => {
  it('deletes and logs a warning row', async () => {
    const p = store.seedProject(scopeA, { name: 'Gone' });
    await service.delete(scopeA, p.id, web);
    expect(store.projectRows.has(p.id)).toBe(false);
    expect(store.activityRows[0]).toMatchObject({
      event_type: 'project.deleted',
      severity: 'warning',
      title: 'Project deleted: Gone',
    });
  });
});

describe('ProjectService.progress', () => {
  it('counts top-level tasks per project within the scope', async () => {
    const p = store.seedProject(scopeA, { name: 'P' });
    store.seedTask(scopeA, { title: 'a', project_id: p.id, status: 'done' });
    store.seedTask(scopeA, {
      title: 'b',
      project_id: p.id,
      status: 'in_progress',
      metadata: { active_session: true },
    });
    store.seedTask(scopeB, { title: 'c', project_id: p.id });
    const progress = await service.progress(scopeA);
    expect(progress[p.id]).toEqual({ taskCount: 2, doneCount: 1, hasActiveTask: true });
  });
});

describe('ProjectService group_id workspace check', () => {
  it('rejects a group from another workspace on create and update', async () => {
    const foreignGroup = store.seedGroup(scopeB);
    await expect(
      service.create(scopeA, { name: 'x', group_id: foreignGroup }, web),
    ).rejects.toBeInstanceOf(NotFound);
    expect([...store.projectRows.values()].filter((p) => p.workspace_id === 'ws-a')).toHaveLength(
      0,
    );

    const project = store.seedProject(scopeA, { name: 'mine' });
    await expect(
      service.update(scopeA, project.id, { group_id: foreignGroup }, web),
    ).rejects.toBeInstanceOf(NotFound);
    expect((await service.get(scopeA, project.id)).group_id).toBeNull();
  });

  it('accepts a group from the same workspace and allows clearing it', async () => {
    const group = store.seedGroup(scopeA);
    const project = await service.create(scopeA, { name: 'x', group_id: group }, web);
    expect(project.group_id).toBe(group);
    const cleared = await service.update(scopeA, project.id, { group_id: null }, web);
    expect(cleared.group_id).toBeNull();
  });
});
