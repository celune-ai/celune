import { randomUUID } from 'node:crypto';
import {
  importBrain,
  type ImportMode,
  type ImportResult,
  type TableResult,
} from '@/lib/brain-transfer';
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  sanitizeAttachmentName,
} from '@/lib/attachment-types';
import { readAll, readByIds, type Db } from './export';
import { ATTACHMENTS_BUCKET, scrubSecrets, type TaskRow, type WorkspaceExportFile } from './format';

type Row = Record<string, unknown>;

const INSERT_BATCH = 200;
/** Ids per delete; keeps the request URL short. */
const DELETE_BATCH = 100;

export interface WorkspaceImportTarget {
  workspaceId: string;
  orgId: string | null;
  userId: string;
}

export type WorkspaceTable =
  'project_groups' | 'projects' | 'tasks' | 'task_comments' | 'task_attachments' | 'agent_configs';

export interface WorkspaceImportResult {
  mode: ImportMode;
  format_version: number;
  counts: Record<WorkspaceTable, TableResult>;
  settings_applied: string[];
  brain: ImportResult | null;
  /** Attachments listed in the file whose bytes were not included. */
  attachments_without_bytes: number;
  deleted?: Partial<Record<WorkspaceTable, number>>;
}

/** Rows and storage objects an overwrite created, removed again if it fails. */
interface Staged {
  rows: Partial<Record<WorkspaceTable, string[]>>;
  paths: string[];
}

function stage(staged: Staged, table: WorkspaceTable, ids: string[]): void {
  (staged.rows[table] ??= []).push(...ids);
}

async function insertBatches(
  db: Db,
  table: WorkspaceTable,
  rows: Row[],
  staged: Staged,
): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH);
    const { error } = await db.from(table).insert(batch);
    if (error) throw error;
    stage(
      staged,
      table,
      batch.map((r) => r.id as string),
    );
    inserted += batch.length;
  }
  return inserted;
}

async function deleteIds(db: Db, table: string, ids: string[]): Promise<number> {
  let removed = 0;
  for (let i = 0; i < ids.length; i += DELETE_BATCH) {
    const batch = ids.slice(i, i + DELETE_BATCH);
    const { data, error } = await db.from(table).delete().in('id', batch).select('id');
    if (error) throw error;
    removed += (data ?? []).length;
  }
  return removed;
}

/** What the target held before an overwrite; deleted only after the import succeeded. */
interface OldRows {
  task_comments: string[];
  task_attachments: Row[];
  tasks: string[];
  projects: string[];
  project_groups: string[];
  agent_ids: string[];
}

async function snapshotOld(db: Db, workspaceId: string): Promise<OldRows> {
  const scoped = { column: 'workspace_id', value: workspaceId };
  const ids = async (table: string) =>
    (await readAll(db, table, ['id'], scoped)).map((r) => r.id as string);
  const tasks = await ids('tasks');
  return {
    task_comments: await ids('task_comments'),
    task_attachments: await readByIds(
      db,
      'task_attachments',
      ['id', 'storage_path'],
      'task_id',
      tasks,
    ),
    tasks,
    projects: await ids('projects'),
    project_groups: await ids('project_groups'),
    agent_ids: (await readAll(db, 'agent_configs', ['agent_id'], scoped, 'agent_id')).map(
      (r) => r.agent_id as string,
    ),
  };
}

async function deleteOld(
  db: Db,
  workspaceId: string,
  old: OldRows,
  keepAgents: Set<string>,
): Promise<Partial<Record<WorkspaceTable, number>>> {
  const deleted: Partial<Record<WorkspaceTable, number>> = {};
  deleted.task_comments = await deleteIds(db, 'task_comments', old.task_comments);
  deleted.task_attachments = await deleteIds(
    db,
    'task_attachments',
    old.task_attachments.map((a) => a.id as string),
  );
  const paths = old.task_attachments
    .map((a) => a.storage_path)
    .filter((p): p is string => typeof p === 'string');
  if (paths.length > 0) await db.storage.from(ATTACHMENTS_BUCKET).remove(paths);
  deleted.tasks = await deleteIds(db, 'tasks', old.tasks);
  deleted.projects = await deleteIds(db, 'projects', old.projects);
  deleted.project_groups = await deleteIds(db, 'project_groups', old.project_groups);
  const dropAgents = old.agent_ids.filter((id) => !keepAgents.has(id));
  if (dropAgents.length > 0) {
    const { error } = await db
      .from('agent_configs')
      .delete()
      .eq('workspace_id', workspaceId)
      .in('agent_id', dropAgents);
    if (error) throw error;
  }
  deleted.agent_configs = dropAgents.length;
  return deleted;
}

/** Best effort: a failed cleanup must not hide the error that caused it. */
async function unstage(db: Db, staged: Staged): Promise<void> {
  for (const table of [
    'task_comments',
    'task_attachments',
    'tasks',
    'projects',
    'project_groups',
  ] as const) {
    await deleteIds(db, table, staged.rows[table] ?? []).catch(() => 0);
  }
  if (staged.paths.length > 0) {
    await db.storage
      .from(ATTACHMENTS_BUCKET)
      .remove(staged.paths)
      .catch(() => null);
  }
}

/**
 * Splits incoming ids into rows already in the target workspace (reused) and
 * ids held by another workspace (the row gets a fresh id).
 */
async function classifyIds(
  db: Db,
  table: string,
  ids: string[],
  workspaceId: string,
): Promise<{ inWorkspace: Set<string>; elsewhere: Set<string> }> {
  const inWorkspace = new Set<string>();
  const elsewhere = new Set<string>();
  const rows = await readByIds(db, table, ['id', 'workspace_id'], 'id', ids);
  for (const row of rows) {
    (row.workspace_id === workspaceId ? inWorkspace : elsewhere).add(row.id as string);
  }
  return { inWorkspace, elsewhere };
}

/** Provenance key stamped into metadata so re-running an import merges instead of duplicating. */
function originOf(row: { id: string; metadata?: unknown }, sourceWorkspace: string): string {
  const meta = row.metadata as { imported_from?: unknown } | null | undefined;
  return typeof meta?.imported_from === 'string'
    ? meta.imported_from
    : `${sourceWorkspace}:${row.id}`;
}

async function originIndex(
  db: Db,
  table: string,
  workspaceId: string,
): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const rows = await readAll(db, table, ['id', 'metadata'], {
    column: 'workspace_id',
    value: workspaceId,
  });
  for (const row of rows) {
    const id = row.id as string;
    index.set(`${workspaceId}:${id}`, id);
    const origin = (row.metadata as { imported_from?: unknown } | null)?.imported_from;
    if (typeof origin === 'string' && !index.has(origin)) index.set(origin, id);
  }
  return index;
}

interface Planned<T> {
  row: T;
  id: string;
}

/** Maps every incoming row to a target id, reusing matches and minting ids on conflict. */
async function planRows<T extends { id: string; metadata?: unknown }>(
  db: Db,
  table: string,
  rows: T[],
  target: WorkspaceImportTarget,
  sourceWorkspace: string,
  idMap: Map<string, string>,
  useOrigin: boolean,
  fresh: boolean,
): Promise<{ toInsert: Planned<T>[]; skipped: number }> {
  const unique = [...new Map(rows.map((r) => [r.id, r])).values()];
  const { inWorkspace, elsewhere } = await classifyIds(
    db,
    table,
    unique.map((r) => r.id),
    target.workspaceId,
  );
  const origins =
    useOrigin && !fresh ? await originIndex(db, table, target.workspaceId) : new Map();
  const toInsert: Planned<T>[] = [];
  let skipped = rows.length - unique.length;
  for (const row of unique) {
    // Overwrite never matches existing rows: they are deleted once the import succeeds.
    const match = fresh
      ? undefined
      : inWorkspace.has(row.id)
        ? row.id
        : origins.get(originOf(row, sourceWorkspace));
    if (match) {
      idMap.set(row.id, match);
      skipped++;
      continue;
    }
    const id = elsewhere.has(row.id) || inWorkspace.has(row.id) ? randomUUID() : row.id;
    idMap.set(row.id, id);
    toInsert.push({ row, id });
  }
  return { toInsert, skipped };
}

function withOrigin(metadata: unknown, origin: string): Record<string, unknown> {
  const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  return { ...(scrubSecrets(base) as Record<string, unknown>), imported_from: origin };
}

/** Parents before children so a batch never references a task inserted later. */
function parentsFirst(tasks: TaskRow[]): TaskRow[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const depth = new Map<string, number>();
  const depthOf = (task: TaskRow, seen: Set<string>): number => {
    const known = depth.get(task.id);
    if (known !== undefined) return known;
    const parent = task.parent_id ? byId.get(task.parent_id) : undefined;
    const d = parent && !seen.has(parent.id) ? depthOf(parent, seen.add(task.id)) + 1 : 0;
    depth.set(task.id, d);
    return d;
  };
  for (const t of tasks) depthOf(t, new Set());
  return [...tasks].sort((a, b) => depth.get(a.id)! - depth.get(b.id)!);
}

async function applySettings(
  db: Db,
  target: WorkspaceImportTarget,
  file: WorkspaceExportFile,
  mode: ImportMode,
): Promise<string[]> {
  const incoming = file.settings;
  const { data, error } = await db
    .from('workspaces')
    .select('description, icon, color_scheme, brain_settings')
    .eq('id', target.workspaceId)
    .maybeSingle();
  if (error) throw error;
  const current = (data ?? {}) as Row;
  const update: Row = {};
  for (const key of ['description', 'icon', 'color_scheme'] as const) {
    const value = incoming[key];
    if (value == null || value === '') continue;
    if (mode === 'overwrite' || current[key] == null || current[key] === '') update[key] = value;
  }
  const brainSettings = incoming.brain_settings;
  if (brainSettings && typeof brainSettings === 'object' && !Array.isArray(brainSettings)) {
    const cleaned = scrubSecrets(brainSettings) as Row;
    const existing = (current.brain_settings as Row | null) ?? {};
    update.brain_settings = mode === 'overwrite' ? cleaned : { ...cleaned, ...existing };
  }
  if (Object.keys(update).length === 0) return [];
  const { error: updateError } = await db
    .from('workspaces')
    .update(update)
    .eq('id', target.workspaceId);
  if (updateError) throw updateError;
  return Object.keys(update);
}

/**
 * Loads a celune-workspace document into the target workspace. Merge keeps
 * every existing row; overwrite replaces the rows scoped to the target
 * workspace, deleting the old ones only after the new ones are in. The source
 * instance is never touched.
 */
export async function importWorkspace(
  db: Db,
  target: WorkspaceImportTarget,
  file: WorkspaceExportFile,
  mode: ImportMode,
  attachmentBytes: Map<string, Uint8Array> = new Map(),
): Promise<WorkspaceImportResult> {
  const source = file.source?.workspace_id ?? 'unknown';
  const owner = { workspace_id: target.workspaceId, user_id: target.userId };
  const result: WorkspaceImportResult = {
    mode,
    format_version: file.format_version,
    counts: {
      project_groups: { inserted: 0, skipped: 0 },
      projects: { inserted: 0, skipped: 0 },
      tasks: { inserted: 0, skipped: 0 },
      task_comments: { inserted: 0, skipped: 0 },
      task_attachments: { inserted: 0, skipped: 0 },
      agent_configs: { inserted: 0, skipped: 0 },
    },
    settings_applied: [],
    brain: null,
    attachments_without_bytes: 0,
  };

  // Overwrite stages the new rows beside the old ones and deletes the old rows
  // only after everything else succeeded; on failure the staged rows are removed.
  const overwrite = mode === 'overwrite';
  const old = overwrite ? await snapshotOld(db, target.workspaceId) : null;
  const staged: Staged = { rows: {}, paths: [] };
  try {
    await importRows(db, target, file, mode, attachmentBytes, result, staged, source, owner);
    if (old) {
      const keep = new Set(file.agent_configs.map((cfg) => cfg.agent_id));
      result.deleted = await deleteOld(db, target.workspaceId, old, keep);
    }
  } catch (error) {
    if (overwrite) await unstage(db, staged);
    throw error;
  }
  return result;
}

async function importRows(
  db: Db,
  target: WorkspaceImportTarget,
  file: WorkspaceExportFile,
  mode: ImportMode,
  attachmentBytes: Map<string, Uint8Array>,
  result: WorkspaceImportResult,
  staged: Staged,
  source: string,
  owner: { workspace_id: string; user_id: string },
): Promise<void> {
  const overwrite = mode === 'overwrite';

  // Project groups: matched by id, then by name.
  const groupMap = new Map<string, string>();
  const groupPlan = await planRows(
    db,
    'project_groups',
    file.project_groups,
    target,
    source,
    groupMap,
    false,
    overwrite,
  );
  const groupNames = new Map(
    overwrite
      ? []
      : (
          await readAll(db, 'project_groups', ['id', 'name'], {
            column: 'workspace_id',
            value: target.workspaceId,
          })
        ).map((g) => [g.name as string, g.id as string]),
  );
  const groupsToInsert = groupPlan.toInsert.filter(({ row }) => {
    const existing = groupNames.get(row.name);
    if (!existing) return true;
    groupMap.set(row.id, existing);
    groupPlan.skipped++;
    return false;
  });
  result.counts.project_groups = {
    inserted: await insertBatches(
      db,
      'project_groups',
      groupsToInsert.map(({ row, id }) => ({ ...row, id, ...owner, org_id: target.orgId })),
      staged,
    ),
    skipped: groupPlan.skipped,
  };

  // Projects.
  const projectMap = new Map<string, string>();
  const projectPlan = await planRows(
    db,
    'projects',
    file.projects,
    target,
    source,
    projectMap,
    true,
    overwrite,
  );
  result.counts.projects = {
    inserted: await insertBatches(
      db,
      'projects',
      projectPlan.toInsert.map(({ row, id }) => ({
        ...row,
        id,
        ...owner,
        org_id: target.orgId,
        group_id: row.group_id ? (groupMap.get(row.group_id) ?? null) : null,
        metadata: withOrigin(row.metadata, originOf(row, source)),
        prd_metadata: row.prd_metadata == null ? null : scrubSecrets(row.prd_metadata),
      })),
      staged,
    ),
    skipped: projectPlan.skipped,
  };

  // Tasks, with parent and dependency references remapped.
  const taskMap = new Map<string, string>();
  const taskPlan = await planRows(
    db,
    'tasks',
    parentsFirst(file.tasks),
    target,
    source,
    taskMap,
    true,
    overwrite,
  );
  const insertOrder = new Map(taskPlan.toInsert.map(({ row }, i) => [row.id, i]));
  // A parent must already exist or be inserted earlier; a cyclic parent link is dropped.
  const parentFor = (row: TaskRow, index: number): string | null => {
    if (!row.parent_id) return null;
    const order = insertOrder.get(row.parent_id);
    if (order !== undefined && order >= index) return null;
    return taskMap.get(row.parent_id) ?? null;
  };
  result.counts.tasks = {
    inserted: await insertBatches(
      db,
      'tasks',
      taskPlan.toInsert.map(({ row, id }, index) => ({
        ...row,
        id,
        ...owner,
        org_id: target.orgId,
        project_id: row.project_id ? (projectMap.get(row.project_id) ?? null) : null,
        parent_id: parentFor(row, index),
        depends_on: (row.depends_on ?? [])
          .map((dep) => taskMap.get(dep))
          .filter((dep): dep is string => !!dep),
        metadata: withOrigin(row.metadata, originOf(row, source)),
      })),
      staged,
    ),
    skipped: taskPlan.skipped,
  };

  // Comments: matched by id, then by task, author, content, and timestamp.
  const commentMap = new Map<string, string>();
  const commentsWithTask = file.task_comments.filter((c) => taskMap.has(c.task_id));
  const commentPlan = await planRows(
    db,
    'task_comments',
    commentsWithTask,
    target,
    source,
    commentMap,
    false,
    overwrite,
  );
  const commentKey = (c: Row) => `${c.task_id}|${c.author}|${c.content}|${c.created_at ?? ''}`;
  const existingComments = new Set(
    (
      await readByIds(
        db,
        'task_comments',
        ['task_id', 'author', 'content', 'created_at'],
        'task_id',
        [...new Set(commentsWithTask.map((c) => taskMap.get(c.task_id)!))],
      )
    ).map(commentKey),
  );
  let commentSkipped = commentPlan.skipped + (file.task_comments.length - commentsWithTask.length);
  const commentRows: Row[] = [];
  for (const { row, id } of commentPlan.toInsert) {
    const mapped = { ...row, id, task_id: taskMap.get(row.task_id)!, ...owner };
    const key = commentKey(mapped);
    if (existingComments.has(key)) {
      commentSkipped++;
      continue;
    }
    existingComments.add(key);
    commentRows.push(mapped);
  }
  result.counts.task_comments = {
    inserted: await insertBatches(db, 'task_comments', commentRows, staged),
    skipped: commentSkipped,
  };

  // Attachments: only rows whose bytes came with the upload are created.
  const attachmentTaskIds = [
    ...new Set(
      file.task_attachments
        .filter((a) => taskMap.has(a.task_id))
        .map((a) => taskMap.get(a.task_id)!),
    ),
  ];
  const existingAttachments = new Set(
    (
      await readByIds(
        db,
        'task_attachments',
        ['task_id', 'file_name', 'file_size'],
        'task_id',
        attachmentTaskIds,
      )
    ).map((a) => `${a.task_id}|${a.file_name}|${a.file_size}`),
  );
  let attachmentInserted = 0;
  let attachmentSkipped = 0;
  for (const att of file.task_attachments) {
    const taskId = taskMap.get(att.task_id);
    const bytes = attachmentBytes.get(att.id.toLowerCase());
    if (!bytes) {
      result.attachments_without_bytes++;
      attachmentSkipped++;
      continue;
    }
    const key = `${taskId}|${att.file_name}|${bytes.byteLength}`;
    if (
      !taskId ||
      existingAttachments.has(key) ||
      bytes.byteLength > MAX_ATTACHMENT_BYTES ||
      !ALLOWED_ATTACHMENT_MIME_TYPES.has(att.mime_type)
    ) {
      attachmentSkipped++;
      continue;
    }
    const storagePath = `${taskId}/${randomUUID()}_${sanitizeAttachmentName(att.file_name)}`;
    const { error: uploadError } = await db.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(storagePath, bytes, { contentType: att.mime_type });
    if (uploadError) throw uploadError;
    const attachmentId = randomUUID();
    const { error } = await db.from('task_attachments').insert({
      id: attachmentId,
      task_id: taskId,
      file_name: att.file_name,
      file_size: bytes.byteLength,
      mime_type: att.mime_type,
      storage_path: storagePath,
      uploaded_by: att.uploaded_by,
      user_id: target.userId,
      created_at: att.created_at,
    });
    if (error) {
      await db.storage.from(ATTACHMENTS_BUCKET).remove([storagePath]);
      throw error;
    }
    stage(staged, 'task_attachments', [attachmentId]);
    staged.paths.push(storagePath);
    existingAttachments.add(key);
    attachmentInserted++;
  }
  result.counts.task_attachments = { inserted: attachmentInserted, skipped: attachmentSkipped };

  // Agent configs: the target's existing config wins on merge; the incoming one replaces it on overwrite.
  const agentRows = file.agent_configs.map((cfg) => ({
    ...cfg,
    ...owner,
    parameters: scrubSecrets(cfg.parameters ?? {}),
    permissions: cfg.permissions == null ? null : scrubSecrets(cfg.permissions),
    voice_settings: cfg.voice_settings == null ? null : scrubSecrets(cfg.voice_settings),
    capabilities: cfg.capabilities == null ? null : scrubSecrets(cfg.capabilities),
  }));
  let agentInserted = 0;
  for (let i = 0; i < agentRows.length; i += INSERT_BATCH) {
    const batch = agentRows.slice(i, i + INSERT_BATCH);
    const { data, error } = await db
      .from('agent_configs')
      .upsert(batch, { onConflict: 'workspace_id,agent_id', ignoreDuplicates: !overwrite })
      .select('agent_id');
    if (error) throw error;
    agentInserted += (data ?? []).length;
  }
  result.counts.agent_configs = {
    inserted: agentInserted,
    skipped: agentRows.length - agentInserted,
  };

  result.settings_applied = await applySettings(db, target, file, mode);

  if (file.brain) {
    // Task links in the knowledge graph follow the task id remap; links to tasks that did not come along are dropped.
    let dropped = 0;
    const relations = file.brain.memory_relations.flatMap((rel) => {
      if (rel.related_type !== 'task') return [rel];
      const mapped = taskMap.get(rel.related_id);
      if (!mapped) {
        dropped++;
        return [];
      }
      return [{ ...rel, related_id: mapped }];
    });
    result.brain = await importBrain(
      db,
      target,
      { ...file.brain, memory_relations: relations },
      mode,
    );
    result.brain.counts.memory_relations.skipped += dropped;
  }
}
