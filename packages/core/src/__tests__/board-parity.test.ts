import { beforeEach, describe, expect, it } from 'vitest';
import type { ActorContext } from '../actor.ts';
import { AttachmentService, type AttachmentFile } from '../attachments/attachment-service.ts';
import { InvalidTransition, NotFound, Unavailable, ValidationError } from '../errors.ts';
import { JobService } from '../jobs/job-service.ts';
import { toExecutionView } from '../jobs/execution-view.ts';
import { ProjectService } from '../projects/project-service.ts';
import { createScope } from '../scope.ts';
import { TaskService } from '../tasks/task-service.ts';
import { InMemoryBlobs } from '../testing/memory-blobs.ts';
import { InMemoryStore } from '../testing/memory-store.ts';

const scopeA = createScope({ workspaceId: 'ws-a', orgId: 'org-a', actorId: 'user-a' });
const scopeB = createScope({ workspaceId: 'ws-b', orgId: 'org-b', actorId: 'user-b' });
const web: ActorContext = { source: 'web', userId: 'user-a' };
const clock = () => new Date('2026-09-27T12:00:00.000Z');

let store: InMemoryStore;
let tasks: TaskService;

beforeEach(() => {
  store = new InMemoryStore({ clock });
  tasks = new TaskService(store, { clock });
});

function file(name: string, type: string, body = 'hello'): AttachmentFile {
  const bytes = new TextEncoder().encode(body);
  return {
    name,
    type,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer as ArrayBuffer,
  };
}

describe('TaskService.count and list paging', () => {
  it('counts with the list filter and pages with offset', async () => {
    for (let i = 0; i < 5; i++) store.seedTask(scopeA, { title: `t${i}`, sort_order: i });
    store.seedTask(scopeA, { title: 'gone', status: 'archived' as never });
    store.seedTask(scopeB, { title: 'other' });
    expect(await tasks.count(scopeA)).toBe(5);
    const page = await tasks.list(scopeA, { limit: 2, offset: 2 });
    expect(page.map((t) => t.title)).toEqual(['t2', 't3']);
  });
});

describe('TaskService relations', () => {
  it('returns dependencies, children with allComplete, and spawned follow-ups', async () => {
    const dep = store.seedTask(scopeA, { title: 'dep' });
    const parent = store.seedTask(scopeA, { title: 'parent', depends_on: [dep.id] });
    store.seedTask(scopeA, { title: 'child 1', parent_id: parent.id, status: 'done' });
    store.seedTask(scopeA, { title: 'child 2', parent_id: parent.id, status: 'inbox' });
    store.seedTask(scopeA, { title: 'follow-up', spawned_by: parent.id });

    expect((await tasks.dependencies(scopeA, parent.id)).map((t) => t.id)).toEqual([dep.id]);
    const kids = await tasks.children(scopeA, parent.id);
    expect(kids.children).toHaveLength(2);
    expect(kids.allComplete).toBe(false);
    expect((await tasks.spawned(scopeA, parent.id)).map((t) => t.title)).toEqual(['follow-up']);
  });

  it('refuses a task from another workspace', async () => {
    const other = store.seedTask(scopeB, { title: 'theirs' });
    await expect(tasks.children(scopeA, other.id)).rejects.toBeInstanceOf(NotFound);
    await expect(tasks.spawned(scopeA, other.id)).rejects.toBeInstanceOf(NotFound);
    await expect(tasks.dependencies(scopeA, other.id)).rejects.toBeInstanceOf(NotFound);
  });
});

describe('TaskService.reorder', () => {
  it('writes order and status, logs each move, and stamps a drop into done', async () => {
    const a = store.seedTask(scopeA, {
      title: 'a',
      status: 'in_progress',
      assignee: 'rick',
      metadata: { claimed_by: 'rick', active_session: true },
    });
    const b = store.seedTask(scopeA, { title: 'b', status: 'inbox' });

    const changed = await tasks.reorder(
      scopeA,
      [
        { id: a.id, status: 'done', sort_order: 0 },
        { id: b.id, status: 'inbox', sort_order: 1 },
      ],
      web,
    );

    expect(changed.map((c) => c.task.id)).toEqual([a.id]);
    const after = store.taskRows.get(a.id);
    expect(after?.status).toBe('done');
    expect(after?.completed_at).toBe('2026-09-27T12:00:00.000Z');
    expect(after?.metadata).toMatchObject({ active_session: false, completed_by: 'rick' });
    expect(store.taskRows.get(b.id)?.sort_order).toBe(1);
    const moves = store.activityRows.filter((r) => r.event_type === 'task.updated');
    expect(moves).toHaveLength(1);
    expect(moves[0]?.title).toBe('Task status changed: in_progress → done');
    const rick = [...store.agentRows.values()].find((r) => r.agent_name === 'rick');
    expect(rick?.status).toBe('online');
  });

  it('refuses the whole batch when one id is outside the workspace', async () => {
    const mine = store.seedTask(scopeA, { title: 'mine', sort_order: 5 });
    const theirs = store.seedTask(scopeB, { title: 'theirs', sort_order: 5 });
    await expect(
      tasks.reorder(
        scopeA,
        [
          { id: mine.id, status: 'inbox', sort_order: 0 },
          { id: theirs.id, status: 'inbox', sort_order: 0 },
        ],
        web,
      ),
    ).rejects.toBeInstanceOf(NotFound);
    expect(store.taskRows.get(mine.id)?.sort_order).toBe(5);
    expect(store.taskRows.get(theirs.id)?.sort_order).toBe(5);
  });

  it('rejects an unknown status', async () => {
    const t = store.seedTask(scopeA, { title: 't' });
    await expect(
      tasks.reorder(scopeA, [{ id: t.id, status: 'nope' as never, sort_order: 0 }], web),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('TaskService.initiate', () => {
  it('assigns the default agent, walks to in_progress, and records the agent as working', async () => {
    const t = store.seedTask(scopeA, { title: 'go', status: 'inbox', assignee: 'unassigned' });
    const result = await tasks.initiate(scopeA, t.id, web);
    expect(result.agentId).toBe('rick');
    expect(result.task.status).toBe('in_progress');
    expect(result.task.metadata).toMatchObject({
      initiated: true,
      initiated_by: 'user-a',
      active_session: true,
      claimed_by: 'rick',
      pre_initiate_status: 'inbox',
    });
    expect(store.activityRows.some((r) => r.event_type === 'task.initiated')).toBe(true);
    const rick = [...store.agentRows.values()].find((r) => r.agent_name === 'rick');
    expect(rick).toMatchObject({ status: 'working', current_task_id: t.id });
    expect(store.heartbeatRows.at(-1)).toMatchObject({
      agentId: 'rick',
      eventType: 'task_started',
    });
  });

  it('keeps an existing assignee and logs once when already in progress', async () => {
    const t = store.seedTask(scopeA, { title: 'go', status: 'in_progress', assignee: 'sage' });
    const result = await tasks.initiate(scopeA, t.id, web);
    expect(result.agentId).toBe('sage');
    expect(store.activityRows.filter((r) => r.event_type === 'task.initiated')).toHaveLength(1);
  });

  it('refuses done and archived tasks', async () => {
    const done = store.seedTask(scopeA, { title: 'd', status: 'done' });
    await expect(tasks.initiate(scopeA, done.id, web)).rejects.toBeInstanceOf(ValidationError);
    const archived = store.seedTask(scopeA, { title: 'a', status: 'archived' as never });
    await expect(tasks.initiate(scopeA, archived.id, web)).rejects.toBeInstanceOf(
      InvalidTransition,
    );
  });
});

describe('ProjectService reorder and progressLog', () => {
  it('reorders in scope and lists done tasks with outcomes oldest first', async () => {
    const projects = new ProjectService(store);
    const p = store.seedProject(scopeA, { name: 'P', sort_order: 3 });
    const q = store.seedProject(scopeB, { name: 'Q', sort_order: 3 });
    await projects.reorder(scopeA, [
      { id: p.id, sort_order: 0 },
      { id: q.id, sort_order: 0 },
    ]);
    expect(store.projectRows.get(p.id)?.sort_order).toBe(0);
    expect(store.projectRows.get(q.id)?.sort_order).toBe(3);

    store.seedTask(scopeA, {
      title: 'late',
      project_id: p.id,
      status: 'done',
      outcome: 'second',
      updated_at: '2026-09-02T00:00:00.000Z',
      metadata: { sprint: 2 },
    });
    store.seedTask(scopeA, {
      title: 'early',
      project_id: p.id,
      status: 'done',
      outcome: 'first',
      updated_at: '2026-09-01T00:00:00.000Z',
    });
    store.seedTask(scopeA, { title: 'no outcome', project_id: p.id, status: 'done' });
    const log = await projects.progressLog(scopeA, p.id);
    expect(log.map((e) => [e.task_title, e.sprint])).toEqual([
      ['early', null],
      ['late', 2],
    ]);
    await expect(projects.progressLog(scopeA, q.id)).rejects.toBeInstanceOf(NotFound);
  });
});

describe('AttachmentService', () => {
  it('uploads valid files, reports invalid ones, lists with URLs, and removes', async () => {
    const blobs = new InMemoryBlobs();
    const service = new AttachmentService(store, { blobs, randomId: () => 'rid' });
    const t = store.seedTask(scopeA, { title: 't' });

    const result = await service.upload(
      scopeA,
      t.id,
      [file('notes.md', ''), file('evil.exe', 'application/x-msdownload')],
      'eric',
      web,
    );
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toMatchObject({
      file_name: 'notes.md',
      mime_type: 'text/markdown',
      storage_path: `${t.id}/rid_notes.md`,
      uploaded_by: 'eric',
      download_url: `memory://${t.id}/rid_notes.md`,
    });
    expect(result.errors).toEqual([
      { file: 'evil.exe', error: 'File type not allowed: application/x-msdownload' },
    ]);
    expect(store.activityRows.some((r) => r.event_type === 'attachment.uploaded')).toBe(true);

    const listed = await service.list(scopeA, t.id);
    expect(listed).toHaveLength(1);

    await service.remove(scopeA, t.id, listed[0]!.id, web);
    expect(await service.list(scopeA, t.id)).toEqual([]);
    expect(blobs.objects.size).toBe(0);
    expect(store.activityRows.some((r) => r.event_type === 'attachment.deleted')).toBe(true);
  });

  it('refuses tasks outside the workspace and uploads without storage', async () => {
    const service = new AttachmentService(store, { blobs: new InMemoryBlobs() });
    const theirs = store.seedTask(scopeB, { title: 'theirs' });
    await expect(service.list(scopeA, theirs.id)).rejects.toBeInstanceOf(NotFound);
    await expect(
      service.upload(scopeA, theirs.id, [file('a.txt', 'text/plain')], 'x', web),
    ).rejects.toBeInstanceOf(NotFound);

    const mine = store.seedTask(scopeA, { title: 'mine' });
    const noStorage = new AttachmentService(store);
    await expect(
      noStorage.upload(scopeA, mine.id, [file('a.txt', 'text/plain')], 'x', web),
    ).rejects.toBeInstanceOf(Unavailable);
    await expect(service.remove(scopeA, mine.id, 'missing', web)).rejects.toBeInstanceOf(NotFound);
  });
});

describe('JobService server runs', () => {
  it('lists runs for a task and cancels the active one by task or id', async () => {
    const jobs = new JobService(store, { clock });
    store.seedJob(scopeA, {
      id: 'run-1',
      runner: 'server',
      target_type: 'task',
      target_id: 'task-1',
      status: 'claimed',
      metadata: { agent_id: 'sage', outcome: 'did it' },
    });
    store.seedJob(scopeA, {
      id: 'ext-1',
      runner: 'external',
      target_type: 'task',
      target_id: 'task-1',
    });
    store.seedJob(scopeB, {
      id: 'run-b',
      runner: 'server',
      target_type: 'task',
      target_id: 'task-1',
    });

    const page = await jobs.listRuns(scopeA, { taskId: 'task-1' });
    expect(page.rows.map((r) => r.id)).toEqual(['run-1']);
    const view = toExecutionView(page.rows[0]!);
    expect(view).toMatchObject({ task_id: 'task-1', agent_id: 'sage', outcome: 'did it' });

    expect(await jobs.cancelRun(scopeA, { executionId: 'ext-1' })).toBeNull();
    expect(await jobs.cancelRun(scopeA, { executionId: 'run-b' })).toBeNull();
    const cancelled = await jobs.cancelRun(scopeA, { taskId: 'task-1' });
    expect(cancelled?.status).toBe('cancelled');
    expect(await jobs.cancelRun(scopeA, { taskId: 'task-1' })).toBeNull();
    await expect(jobs.cancelRun(scopeA, {})).rejects.toBeInstanceOf(ValidationError);
  });

  it('decrypts a stored result when the host passes a decryptor', () => {
    const view = toExecutionView(
      { id: 'j', status: 'completed', result_encrypted: 'enc', result_iv: 'iv' },
      () => JSON.stringify({ content: 'plain' }),
    );
    expect(view.outcome).toBe('plain');
  });
});
