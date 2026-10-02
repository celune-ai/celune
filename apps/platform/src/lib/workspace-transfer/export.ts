import type { createServiceClient } from '@repo/db/service';
import { exportToObject } from '@/lib/brain-transfer';
import {
  AGENT_CONFIG_COLUMNS,
  ATTACHMENT_COLUMNS,
  COMMENT_COLUMNS,
  GROUP_COLUMNS,
  PROJECT_COLUMNS,
  SETTINGS_COLUMNS,
  TASK_COLUMNS,
  WORKSPACE_EXPORT_FORMAT,
  WORKSPACE_FORMAT_VERSION,
  pickRow,
  type AgentConfigRow,
  type AttachmentRow,
  type CommentRow,
  type GroupRow,
  type ProjectRow,
  type TaskRow,
  type WorkspaceExportFile,
  type WorkspaceSettings,
} from './format';

export type Db = ReturnType<typeof createServiceClient>;
type Row = Record<string, unknown>;

const PAGE_SIZE = 500;

export async function readAll(
  db: Db,
  table: string,
  columns: readonly string[],
  filter: { column: string; value: string },
  orderBy = 'id',
): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from(table)
      .select(columns.join(', '))
      .eq(filter.column, filter.value)
      .order(orderBy, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Row[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
  }
}

export async function readByIds(
  db: Db,
  table: string,
  columns: readonly string[],
  column: string,
  ids: string[],
): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += PAGE_SIZE) {
    const { data, error } = await db
      .from(table)
      .select(columns.join(', '))
      .in(column, ids.slice(i, i + PAGE_SIZE));
    if (error) throw error;
    out.push(...((data ?? []) as unknown as Row[]));
  }
  return out;
}

/** Parent and dependency links to tasks outside the workspace are dropped, so no foreign id leaves. */
function withLocalRefs(task: TaskRow, taskIds: Set<string>): TaskRow {
  return {
    ...task,
    parent_id: task.parent_id && taskIds.has(task.parent_id) ? task.parent_id : null,
    depends_on: (task.depends_on ?? []).filter((id) => taskIds.has(id)),
  };
}

export interface WorkspaceExport {
  file: WorkspaceExportFile;
  /** Attachment id to storage object path, for callers that bundle the bytes. */
  storagePaths: Map<string, string>;
}

/** Reads one workspace into a celune-workspace v1 document. Source rows are only read. */
export async function exportWorkspace(
  db: Db,
  workspaceId: string,
  edition: string,
): Promise<WorkspaceExport> {
  const scope = { column: 'workspace_id', value: workspaceId };

  const { data: ws, error: wsError } = await db
    .from('workspaces')
    .select(SETTINGS_COLUMNS.join(', '))
    .eq('id', workspaceId)
    .maybeSingle();
  if (wsError) throw wsError;

  const [groups, projects, tasks, comments, agentConfigs] = await Promise.all([
    readAll(db, 'project_groups', GROUP_COLUMNS, scope),
    readAll(db, 'projects', PROJECT_COLUMNS, scope),
    readAll(db, 'tasks', TASK_COLUMNS, scope),
    readAll(db, 'task_comments', COMMENT_COLUMNS, scope),
    readAll(db, 'agent_configs', AGENT_CONFIG_COLUMNS, scope, 'agent_id'),
  ]);

  const attachments = await readByIds(
    db,
    'task_attachments',
    [...ATTACHMENT_COLUMNS, 'storage_path'],
    'task_id',
    tasks.map((t) => t.id as string),
  );
  const storagePaths = new Map<string, string>();
  for (const a of attachments) storagePaths.set(a.id as string, a.storage_path as string);

  const brain = await exportToObject(db, workspaceId);
  const taskIds = new Set(tasks.map((t) => t.id as string));
  const relations = brain.memory_relations.filter(
    (rel) => rel.related_type !== 'task' || taskIds.has(rel.related_id),
  );

  const file: WorkspaceExportFile = {
    format: WORKSPACE_EXPORT_FORMAT,
    format_version: WORKSPACE_FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    source: { workspace_id: workspaceId, edition },
    counts: {
      project_groups: groups.length,
      projects: projects.length,
      tasks: tasks.length,
      task_comments: comments.length,
      task_attachments: attachments.length,
      agent_configs: agentConfigs.length,
      agent_memory: brain.agent_memory.length,
      memory_relations: relations.length,
      brain_manifest: brain.brain_manifest.length,
    },
    settings: ws ? (pickRow(ws as unknown as Row, SETTINGS_COLUMNS) as WorkspaceSettings) : {},
    project_groups: groups.map((r) => pickRow(r, GROUP_COLUMNS) as GroupRow),
    projects: projects.map((r) => pickRow(r, PROJECT_COLUMNS) as ProjectRow),
    tasks: tasks.map((r) => withLocalRefs(pickRow(r, TASK_COLUMNS) as TaskRow, taskIds)),
    task_comments: comments.map((r) => pickRow(r, COMMENT_COLUMNS) as CommentRow),
    task_attachments: attachments.map((r) => pickRow(r, ATTACHMENT_COLUMNS) as AttachmentRow),
    agent_configs: agentConfigs.map((r) => pickRow(r, AGENT_CONFIG_COLUMNS) as AgentConfigRow),
    brain: {
      ...brain,
      memory_relations: relations,
    },
  };
  return { file, storagePaths };
}
