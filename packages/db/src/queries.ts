import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Task,
  TaskInsert,
  TaskUpdate,
  TaskStatus,
  TaskComment,
  Project,
  ProjectInsert,
  ProjectUpdate,
  ProjectGroup,
  ProjectGroupInsert,
  ProjectGroupUpdate,
  ActivityEntry,
  ActivityInsert,
  AgentMemory,
  MemoryCategory,
} from '@repo/types';

// --- Workspace filter types ---

/** Workspace scope: callers must provide at least one of workspace_id or workspace_ids. */
export type WorkspaceScope =
  | { workspace_id: string; workspace_ids?: never }
  | { workspace_id?: never; workspace_ids: string[] };

// --- Tasks ---

/** Columns needed for task list/board views — includes description + outcome for drawer */
const TASK_LIST_COLUMNS =
  'id, title, description, outcome, status, priority, assignee, project_id, user_id, org_id, workspace_id, category, due_date, source, source_ref, vault_path, time_estimate_minutes, time_spent_minutes, parent_id, spawned_by, context_keys, metadata, effort, depends_on, sort_order, created_at, updated_at, completed_at, archived_at';

export async function getTasks(
  supabase: SupabaseClient,
  filters: { status?: TaskStatus; project_id?: string; top_level_only?: boolean } & WorkspaceScope,
) {
  let query = supabase
    .from('tasks')
    .select(TASK_LIST_COLUMNS)
    .neq('status', 'archived')
    .order('sort_order', { ascending: true })
    .limit(2000);

  if (filters.status) {
    query = query.eq('status', filters.status);
  }
  if (filters.project_id) {
    query = query.eq('project_id', filters.project_id);
  }
  if (filters.top_level_only) {
    query = query.is('parent_id', null);
  }
  if (filters.workspace_ids && filters.workspace_ids.length > 0) {
    query = query.in('workspace_id', filters.workspace_ids);
  } else if (filters.workspace_id) {
    query = query.eq('workspace_id', filters.workspace_id);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data as Task[];
}

export async function getTask(supabase: SupabaseClient, id: string, workspaceId: string) {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .single();
  if (error) throw error;
  return data as Task;
}

export async function createTask(
  supabase: SupabaseClient,
  task: Partial<TaskInsert> & { title: string },
) {
  // Auto-inherit org_id and workspace_id from the parent project
  let inherited: { org_id?: string; workspace_id?: string } = {};
  if (task.project_id && !task.org_id) {
    const { data: proj } = await supabase
      .from('projects')
      .select('org_id,workspace_id')
      .eq('id', task.project_id)
      .single();
    if (proj) {
      inherited = {
        ...(proj.org_id ? { org_id: proj.org_id } : {}),
        ...(proj.workspace_id ? { workspace_id: proj.workspace_id } : {}),
      };
    }
  }

  const resolvedWorkspaceId = task.workspace_id ?? inherited.workspace_id;
  if (!resolvedWorkspaceId) {
    throw new Error('workspace_id is required when creating a task');
  }

  // Scope sort_order max query to workspace
  let maxOrderQuery = supabase
    .from('tasks')
    .select('sort_order')
    .eq('status', task.status ?? 'inbox')
    .eq('workspace_id', resolvedWorkspaceId)
    .order('sort_order', { ascending: false })
    .limit(1);
  const { data: maxOrder } = await maxOrderQuery.single();

  const sort_order = (maxOrder?.sort_order ?? 0) + 1000;

  const merged = {
    status: 'inbox' as const,
    priority: 'normal' as const,
    assignee: 'unassigned' as const,
    category: [],
    sort_order,
    ...inherited,
    ...task,
  };

  if (!merged.workspace_id) {
    merged.workspace_id = resolvedWorkspaceId;
  }

  const { data, error } = await supabase.from('tasks').insert(merged).select().single();
  if (error) throw error;
  return data as Task;
}

export async function updateTask(
  supabase: SupabaseClient,
  id: string,
  updates: TaskUpdate,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from('tasks')
    .update(updates)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select()
    .single();
  if (error) throw error;
  return data as Task;
}

export async function deleteTask(supabase: SupabaseClient, id: string, workspaceId: string) {
  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspaceId);
  if (error) throw error;
}

export async function getChildTasks(
  supabase: SupabaseClient,
  parentId: string,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('parent_id', parentId)
    .eq('workspace_id', workspaceId)
    .order('sort_order', { ascending: true })
    .limit(500);
  if (error) throw error;
  return data as Task[];
}

export async function areChildrenComplete(
  supabase: SupabaseClient,
  parentId: string,
  workspaceId: string,
) {
  const { count, error } = await supabase
    .from('tasks')
    .select('*', { count: 'exact', head: true })
    .eq('parent_id', parentId)
    .eq('workspace_id', workspaceId)
    .not('status', 'in', '("done","archived")');
  if (error) throw error;
  return (count ?? 0) === 0;
}

export async function reorderTasks(
  supabase: SupabaseClient,
  updates: { id: string; status: TaskStatus; sort_order: number; workspace_id: string }[],
) {
  const results = await Promise.all(
    updates.map((update) =>
      supabase
        .from('tasks')
        .update({ status: update.status, sort_order: update.sort_order })
        .eq('id', update.id)
        .eq('workspace_id', update.workspace_id),
    ),
  );
  for (const { error } of results) {
    if (error) throw error;
  }
}

// --- Task Comments ---

export async function getComments(supabase: SupabaseClient, taskId: string, workspaceId: string) {
  const { data, error } = await supabase
    .from('task_comments')
    .select('*')
    .eq('task_id', taskId)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) throw error;
  return data as TaskComment[];
}

export async function createComment(
  supabase: SupabaseClient,
  comment: { task_id: string; author: string; content: string },
) {
  const { data, error } = await supabase.from('task_comments').insert(comment).select().single();
  if (error) throw error;
  return data as TaskComment;
}

// --- Projects ---

/** Columns needed for project list views — excludes large prd_content */
const PROJECT_LIST_COLUMNS =
  'id, name, description, status, project_type, category, group_id, sort_order, metadata, workspace_id, user_id, created_at, updated_at';

export async function getProjects(supabase: SupabaseClient, filters: WorkspaceScope) {
  let query = supabase
    .from('projects')
    .select(PROJECT_LIST_COLUMNS)
    .order('sort_order', { ascending: true })
    .limit(500);

  if (filters.workspace_ids && filters.workspace_ids.length > 0) {
    query = query.in('workspace_id', filters.workspace_ids);
  } else if (filters.workspace_id) {
    query = query.eq('workspace_id', filters.workspace_id);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data as Project[];
}

export async function getProjectTaskCounts(
  supabase: SupabaseClient,
  filters: WorkspaceScope,
): Promise<Record<string, { taskCount: number; doneCount: number; hasActiveTask: boolean }>> {
  // Fetch project_id, status, and active_session for all top-level non-archived tasks
  let query = supabase
    .from('tasks')
    .select('project_id, status, metadata')
    .not('project_id', 'is', null)
    .is('parent_id', null)
    .neq('status', 'archived');

  if (filters.workspace_ids && filters.workspace_ids.length > 0) {
    query = query.in('workspace_id', filters.workspace_ids);
  } else if (filters.workspace_id) {
    query = query.eq('workspace_id', filters.workspace_id);
  }

  const { data, error } = await query;
  if (error) throw error;

  const map: Record<string, { taskCount: number; doneCount: number; hasActiveTask: boolean }> = {};
  for (const row of data ?? []) {
    const pid = row.project_id as string;
    if (!map[pid]) map[pid] = { taskCount: 0, doneCount: 0, hasActiveTask: false };
    map[pid].taskCount++;
    if (row.status === 'done') map[pid].doneCount++;
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    if (meta.active_session && row.status !== 'done') map[pid].hasActiveTask = true;
  }
  return map;
}

export async function getProject(supabase: SupabaseClient, id: string, workspaceId: string) {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .single();
  if (error) throw error;
  return data as Project;
}

export async function createProject(
  supabase: SupabaseClient,
  project: Partial<ProjectInsert> & { name: string },
) {
  if (!project.workspace_id) {
    throw new Error('workspace_id is required when creating a project');
  }

  const { data, error } = await supabase
    .from('projects')
    .insert({
      status: 'active',
      ...project,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Project;
}

export async function updateProject(
  supabase: SupabaseClient,
  id: string,
  updates: ProjectUpdate,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from('projects')
    .update(updates)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select()
    .single();
  if (error) throw error;
  return data as Project;
}

export async function deleteProject(supabase: SupabaseClient, id: string, workspaceId: string) {
  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspaceId);
  if (error) throw error;
}

export async function reorderProjects(
  supabase: SupabaseClient,
  updates: { id: string; sort_order: number; workspace_id: string }[],
) {
  const results = await Promise.all(
    updates.map((update) =>
      supabase
        .from('projects')
        .update({ sort_order: update.sort_order })
        .eq('id', update.id)
        .eq('workspace_id', update.workspace_id),
    ),
  );
  for (const { error } of results) {
    if (error) throw error;
  }
}

// --- Project Groups ---

export async function getProjectGroups(supabase: SupabaseClient, filters: WorkspaceScope) {
  let query = supabase
    .from('project_groups')
    .select('id, name, sort_order, workspace_id, created_at, updated_at')
    .order('sort_order', { ascending: true })
    .limit(200);

  if (filters.workspace_ids && filters.workspace_ids.length > 0) {
    query = query.in('workspace_id', filters.workspace_ids);
  } else if (filters.workspace_id) {
    query = query.eq('workspace_id', filters.workspace_id);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data as ProjectGroup[];
}

export async function getProjectGroup(supabase: SupabaseClient, id: string, workspaceId: string) {
  const { data, error } = await supabase
    .from('project_groups')
    .select('*')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .single();
  if (error) throw error;
  return data as ProjectGroup;
}

export async function createProjectGroup(
  supabase: SupabaseClient,
  group: Partial<ProjectGroupInsert> & { name: string; workspace_id: string },
) {
  const { data: maxOrder } = await supabase
    .from('project_groups')
    .select('sort_order')
    .eq('workspace_id', group.workspace_id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .single();

  const sort_order = (maxOrder?.sort_order ?? 0) + 1000;

  const { data, error } = await supabase
    .from('project_groups')
    .insert({ sort_order, ...group })
    .select()
    .single();
  if (error) throw error;
  return data as ProjectGroup;
}

export async function updateProjectGroup(
  supabase: SupabaseClient,
  id: string,
  updates: ProjectGroupUpdate,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from('project_groups')
    .update(updates)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select()
    .single();
  if (error) throw error;
  return data as ProjectGroup;
}

export async function deleteProjectGroup(
  supabase: SupabaseClient,
  id: string,
  workspaceId: string,
) {
  const { error } = await supabase
    .from('project_groups')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspaceId);
  if (error) throw error;
}

export async function reorderProjectGroups(
  supabase: SupabaseClient,
  updates: { id: string; sort_order: number; workspace_id: string }[],
) {
  const results = await Promise.all(
    updates.map((update) =>
      supabase
        .from('project_groups')
        .update({ sort_order: update.sort_order })
        .eq('id', update.id)
        .eq('workspace_id', update.workspace_id),
    ),
  );
  for (const { error } of results) {
    if (error) throw error;
  }
}

// --- Activity ---

export async function getActivity(
  supabase: SupabaseClient,
  filters: {
    event_type?: string;
    severity?: string;
    severity_in?: string[];
    agent_id?: string;
    task_id?: string;
    actor_user_id?: string;
    acknowledged?: boolean;
    limit?: number;
    offset?: number;
  } & WorkspaceScope,
): Promise<{ data: ActivityEntry[]; total: number }> {
  let query = supabase
    .from('activity_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (filters.event_type) {
    query = query.eq('event_type', filters.event_type);
  }
  if (filters.severity_in && filters.severity_in.length > 0) {
    query = query.in('severity', filters.severity_in);
  } else if (filters.severity) {
    query = query.eq('severity', filters.severity);
  }
  if (filters.agent_id) {
    query = query.eq('agent_id', filters.agent_id);
  }
  if (filters.task_id) {
    query = query.eq('task_id', filters.task_id);
  }
  if (filters.actor_user_id) {
    query = query.eq('actor_user_id', filters.actor_user_id);
  }
  if (filters.workspace_ids && filters.workspace_ids.length > 0) {
    query = query.in('workspace_id', filters.workspace_ids);
  } else if (filters.workspace_id) {
    query = query.eq('workspace_id', filters.workspace_id);
  }
  if (filters.acknowledged !== undefined) {
    if (filters.acknowledged === false) {
      query = query.is('acknowledged_at', null);
    } else {
      query = query.not('acknowledged_at', 'is', null);
    }
  }

  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;
  query = query.range(offset, offset + limit - 1);

  const { data, count, error } = await query;
  if (error) throw error;
  return { data: (data ?? []) as ActivityEntry[], total: count ?? 0 };
}

export async function acknowledgeActivity(
  supabase: SupabaseClient,
  id: string,
  workspaceId: string,
) {
  const { error } = await supabase
    .from('activity_log')
    .update({ acknowledged_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_id', workspaceId);
  if (error) throw error;
}

export async function acknowledgeActivities(
  supabase: SupabaseClient,
  ids: string[],
  workspaceId: string,
) {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from('activity_log')
    .update({ acknowledged_at: new Date().toISOString() })
    .in('id', ids)
    .eq('workspace_id', workspaceId);
  if (error) throw error;
}

export async function getAgentAuditTrail(
  supabase: SupabaseClient,
  agentId: string,
  options: { limit?: number; offset?: number } & WorkspaceScope,
): Promise<{ data: ActivityEntry[]; total: number }> {
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;

  let query = supabase
    .from('activity_log')
    .select('*', { count: 'exact' })
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (options.workspace_ids && options.workspace_ids.length > 0) {
    query = query.in('workspace_id', options.workspace_ids);
  } else if (options.workspace_id) {
    query = query.eq('workspace_id', options.workspace_id);
  }

  const { data, count, error } = await query;

  if (error) throw error;
  return { data: (data ?? []) as ActivityEntry[], total: count ?? 0 };
}

export async function createActivity(supabase: SupabaseClient, entry: ActivityInsert) {
  const { data, error } = await supabase.from('activity_log').insert(entry).select().single();
  if (error) throw error;
  return data as ActivityEntry;
}

// --- Health Alerts (dedup) ---

/**
 * Upsert a health-derived alert with 24h deduplication.
 * If an unacknowledged alert with the same event_type exists within the last 24h,
 * increments instance_count and updates last_seen. Otherwise inserts a new row.
 */
export async function upsertHealthAlert(
  supabase: SupabaseClient,
  alert: {
    event_type: string;
    severity: 'warning' | 'error';
    title: string;
    source?: string;
    details?: Record<string, unknown>;
    workspace_id?: string;
  },
) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Look for existing unacknowledged alert with same event_type in last 24h
  let dedupQuery = supabase
    .from('activity_log')
    .select('id, details')
    .eq('event_type', alert.event_type)
    .is('acknowledged_at', null)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1);
  if (alert.workspace_id) {
    dedupQuery = dedupQuery.eq('workspace_id', alert.workspace_id);
  }
  const { data: existing } = await dedupQuery.maybeSingle();

  if (existing) {
    // Increment instance_count and update last_seen
    const prevDetails = (existing.details ?? {}) as Record<string, unknown>;
    const instanceCount =
      (typeof prevDetails.instance_count === 'number' ? prevDetails.instance_count : 1) + 1;
    const { error } = await supabase
      .from('activity_log')
      .update({
        details: {
          ...prevDetails,
          ...alert.details,
          instance_count: instanceCount,
          last_seen: new Date().toISOString(),
        },
      })
      .eq('id', existing.id);
    if (error) throw error;
    return { action: 'incremented' as const, id: existing.id, instance_count: instanceCount };
  }

  // Insert new alert
  const entry: ActivityInsert = {
    event_type: alert.event_type,
    severity: alert.severity,
    title: alert.title,
    source: alert.source ?? 'health',
    details: { ...alert.details, instance_count: 1 },
  };
  const result = await createActivity(supabase, entry);
  return { action: 'inserted' as const, id: result.id, instance_count: 1 };
}

// --- Agent Memory ---

export async function getAgentMemoryEntries(
  supabase: SupabaseClient,
  filters: {
    category?: MemoryCategory;
    source?: string;
    limit?: number;
    offset?: number;
    include_archived?: boolean;
  } & WorkspaceScope,
): Promise<{ data: AgentMemory[]; total: number }> {
  let query = supabase
    .from('agent_memory')
    .select('*', { count: 'exact' })
    .order('updated_at', { ascending: false });

  // Exclude archived memories by default
  if (!filters.include_archived) {
    query = query.eq('is_archived', false);
  }

  if (filters.category) {
    query = query.eq('category', filters.category);
  }
  if (filters.source) {
    query = query.eq('source', filters.source);
  }
  if (filters.workspace_ids && filters.workspace_ids.length > 0) {
    query = query.in('workspace_id', filters.workspace_ids);
  } else if (filters.workspace_id) {
    query = query.eq('workspace_id', filters.workspace_id);
  }

  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;
  query = query.range(offset, offset + limit - 1);

  const { data, count, error } = await query;
  if (error) throw error;
  return { data: (data ?? []) as AgentMemory[], total: count ?? 0 };
}

export async function getAgentMemoryByKey(
  supabase: SupabaseClient,
  key: string,
  wsFilter: WorkspaceScope,
): Promise<AgentMemory | null> {
  let query = supabase.from('agent_memory').select('*').eq('key', key);
  if (wsFilter.workspace_ids && wsFilter.workspace_ids.length > 0) {
    query = query.in('workspace_id', wsFilter.workspace_ids);
  } else if (wsFilter.workspace_id) {
    query = query.eq('workspace_id', wsFilter.workspace_id);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data as AgentMemory | null;
}

export async function getAgentMemoryByKeys(
  supabase: SupabaseClient,
  keys: string[],
  wsFilter: WorkspaceScope,
): Promise<AgentMemory[]> {
  if (keys.length === 0) return [];
  let query = supabase
    .from('agent_memory')
    .select('*')
    .in('key', keys.slice(0, 100))
    .order('updated_at', { ascending: false })
    .limit(100);
  if (wsFilter.workspace_ids && wsFilter.workspace_ids.length > 0) {
    query = query.in('workspace_id', wsFilter.workspace_ids);
  } else if (wsFilter.workspace_id) {
    query = query.eq('workspace_id', wsFilter.workspace_id);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as AgentMemory[];
}

export async function upsertAgentMemory(
  supabase: SupabaseClient,
  entry: {
    workspace_id: string;
    key: string;
    content: string;
    category?: MemoryCategory;
    source?: string;
    tags?: string;
    user_id?: string;
    agent_id?: string;
    memory_type?: string;
    importance_score?: number;
  },
): Promise<AgentMemory> {
  // Episode memories are immutable — reject updates to existing episodes
  if (entry.category !== 'episode') {
    const { data: existing } = await supabase
      .from('agent_memory')
      .select('id, category')
      .eq('workspace_id', entry.workspace_id)
      .eq('key', entry.key)
      .maybeSingle();
    if (existing?.category === 'episode') {
      throw new Error('Episode memories are immutable and cannot be updated');
    }
  }

  const row = {
    workspace_id: entry.workspace_id,
    key: entry.key,
    content: entry.content,
    category: entry.category ?? 'general',
    source: entry.source ?? 'user',
    tags: entry.tags ?? '',
    user_id: entry.user_id ?? null,
    agent_id: entry.agent_id ?? 'system',
    memory_type: entry.memory_type ?? 'context',
    importance_score: entry.importance_score ?? 0.5,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('agent_memory')
    .upsert(row, { onConflict: 'workspace_id,key', ignoreDuplicates: false })
    .select('*')
    .single();
  if (error) throw error;
  return data as AgentMemory;
}

/**
 * Full-text search across agent_memory using the tsvector `fts` column.
 * Falls back to ILIKE if the query cannot be converted to a valid tsquery.
 */
export async function searchAgentMemories(
  supabase: SupabaseClient,
  filters: {
    workspace_id: string;
    query: string;
    category?: MemoryCategory;
    tags?: string[];
    limit?: number;
  },
): Promise<AgentMemory[]> {
  const limit = filters.limit ?? 20;
  const q = filters.query.trim();

  if (!q) return [];

  // Convert user query to tsquery format: split words and join with &
  const words = q.split(/\s+/).filter(Boolean);
  const tsquery = words
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean)
    .join(' & ');

  if (!tsquery) {
    // Fallback to ILIKE for queries that produce no valid tsquery tokens
    let query = supabase
      .from('agent_memory')
      .select('*')
      .eq('workspace_id', filters.workspace_id)
      .eq('is_archived', false)
      .ilike('content', `%${q.replace(/[%_]/g, '\\$&')}%`)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (filters.category) {
      query = query.eq('category', filters.category);
    }
    if (filters.tags?.length) {
      for (const tag of filters.tags) {
        query = query.ilike('tags', `%${tag.replace(/[%_]/g, '\\$&')}%`);
      }
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as AgentMemory[];
  }

  // Use FTS with tsvector column
  let query = supabase
    .from('agent_memory')
    .select('*')
    .eq('workspace_id', filters.workspace_id)
    .eq('is_archived', false)
    .textSearch('fts', tsquery, { type: 'plain', config: 'english' })
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (filters.category) {
    query = query.eq('category', filters.category);
  }
  if (filters.tags?.length) {
    for (const tag of filters.tags) {
      query = query.ilike('tags', `%${tag.replace(/[%_]/g, '\\$&')}%`);
    }
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as AgentMemory[];
}

/** Result row from hybrid_brain_search() RPC. */
export interface HybridSearchResult {
  id: string;
  key: string;
  content: string;
  abstract: string | null;
  category: string;
  source: string;
  tags: string | null;
  memory_type: string;
  importance_score: number;
  vector_similarity: number;
  keyword_rank: number;
  combined_score: number;
  created_at: string;
  updated_at: string;
}

/**
 * Hybrid brain search: combines pgvector cosine similarity with tsvector keyword ranking.
 * Falls back to keyword-only if no embedding is provided, or vector-only if query_text is empty.
 */
export async function hybridBrainSearch(
  supabase: SupabaseClient,
  filters: {
    query_embedding: number[];
    query_text: string;
    workspace_id: string;
    limit?: number;
    vector_weight?: number;
    keyword_weight?: number;
    category?: string;
    source?: string;
    include_archived?: boolean;
  },
): Promise<HybridSearchResult[]> {
  const { data, error } = await supabase.rpc('hybrid_brain_search', {
    query_embedding: JSON.stringify(filters.query_embedding),
    query_text: filters.query_text,
    filter_workspace_id: filters.workspace_id,
    match_count: filters.limit ?? 20,
    p_vector_weight: filters.vector_weight ?? 0.7,
    p_keyword_weight: filters.keyword_weight ?? 0.3,
    filter_category: filters.category ?? null,
    filter_source: filters.source ?? null,
    p_include_archived: filters.include_archived ?? false,
  });
  if (error) throw error;
  return (data ?? []) as HybridSearchResult[];
}

/** Result row from search_code_examples() RPC. */
export interface CodeExampleSearchResult {
  id: string;
  code_block: string;
  language: string;
  summary: string | null;
  source_path: string | null;
  vector_similarity: number;
  keyword_rank: number;
  combined_score: number;
}

/**
 * Search code examples extracted from brain manifest skills.
 * Uses hybrid vector + keyword search, weighted toward exact matches (60/40).
 */
export async function searchCodeExamples(
  supabase: SupabaseClient,
  filters: {
    query_embedding: number[];
    query_text: string;
    workspace_id: string;
    limit?: number;
    language?: string;
  },
): Promise<CodeExampleSearchResult[]> {
  const { data, error } = await supabase.rpc('search_code_examples', {
    query_embedding: JSON.stringify(filters.query_embedding),
    query_text: filters.query_text,
    filter_workspace_id: filters.workspace_id,
    match_count: filters.limit ?? 10,
    filter_language: filters.language ?? null,
  });
  if (error) throw error;
  return (data ?? []) as CodeExampleSearchResult[];
}

/**
 * Get memory stats for a workspace: count, category breakdown, source breakdown.
 */
export async function getAgentMemoryStats(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<{
  total: number;
  by_category: Record<string, number>;
  by_source: Record<string, number>;
  latest_updated_at: string | null;
}> {
  // Run all queries in parallel for better latency
  const [countResult, breakdownResult, latestResult] = await Promise.all([
    supabase
      .from('agent_memory')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId),
    // Category + source breakdown — limit to prevent full table scan
    supabase
      .from('agent_memory')
      .select('category, source')
      .eq('workspace_id', workspaceId)
      .limit(10000),
    // Latest update — single row instead of sorting all
    supabase
      .from('agent_memory')
      .select('updated_at')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (countResult.error) throw countResult.error;
  if (breakdownResult.error) throw breakdownResult.error;
  if (latestResult.error) throw latestResult.error;

  const by_category: Record<string, number> = {};
  const by_source: Record<string, number> = {};
  for (const m of breakdownResult.data ?? []) {
    by_category[m.category] = (by_category[m.category] ?? 0) + 1;
    by_source[m.source] = (by_source[m.source] ?? 0) + 1;
  }

  return {
    total: countResult.count ?? 0,
    by_category,
    by_source,
    latest_updated_at: latestResult.data?.updated_at ?? null,
  };
}

// --- Project Task Completion Verification ---

export interface TaskCompletionReport {
  allDone: boolean;
  incomplete: Array<{ id: string; title: string; status: string; sprint: number }>;
  complete: Array<{ id: string; title: string; sprint: number }>;
  closing: Array<{ id: string; title: string; status: string; sprint: number }>;
  summary: string;
}

/**
 * Verify all implementation tasks in a project are completed.
 * Implementation tasks = sprint 1+ and sprint < 99 (not closing tasks).
 * Returns a structured report usable by /git-review and /build.
 */
export async function verifyProjectTaskCompletion(
  supabase: SupabaseClient,
  projectId: string,
  workspaceId: string,
): Promise<TaskCompletionReport> {
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, title, status, metadata')
    .eq('project_id', projectId)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })
    .limit(500);

  if (error) throw error;

  const incomplete: TaskCompletionReport['incomplete'] = [];
  const complete: TaskCompletionReport['complete'] = [];
  const closing: TaskCompletionReport['closing'] = [];

  for (const t of tasks ?? []) {
    const meta = (t.metadata ?? {}) as Record<string, unknown>;
    const sprint = (meta.sprint as number) ?? 1;

    if (sprint === 0) {
      // PRD task — skip from verification
      continue;
    }

    if (sprint >= 99) {
      closing.push({ id: t.id, title: t.title, status: t.status, sprint });
      continue;
    }

    if (t.status === 'done') {
      complete.push({ id: t.id, title: t.title, sprint });
    } else {
      incomplete.push({ id: t.id, title: t.title, status: t.status, sprint });
    }
  }

  const allDone = incomplete.length === 0;
  const summary = allDone
    ? `All ${complete.length} implementation tasks are done. Ready for closing sequence.`
    : `${incomplete.length} of ${incomplete.length + complete.length} implementation tasks are not done:\n` +
      incomplete.map((t) => `  - [${t.status}] ${t.title} (${t.id.slice(0, 8)})`).join('\n');

  return { allDone, incomplete, complete, closing, summary };
}
