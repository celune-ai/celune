import type { Project } from '@repo/types';
import type { ActorContext } from '../actor.ts';
import { GateDenied, NotFound } from '../errors.ts';
import { NoopGate, type Gate } from '../gate.ts';
import type { WorkspaceScope } from '../scope.ts';
import type {
  ProjectCreateInput,
  ProjectListFilter,
  ProjectPatch,
  ProjectProgress,
  ProjectReorderItem,
  Store,
} from '../store.ts';

/** One completed task with an outcome, as the project timeline shows it. */
export interface ProjectProgressEntry {
  id: string;
  timestamp: string;
  agent: string;
  task_title: string;
  task_id: string;
  outcome: string;
  sprint: number | null;
}

export interface ProjectServiceOptions {
  gate?: Gate;
}

export class ProjectService {
  private readonly store: Store;
  private readonly gate: Gate;

  constructor(store: Store, options: ProjectServiceOptions = {}) {
    this.store = store;
    this.gate = options.gate ?? new NoopGate();
  }

  list(scope: WorkspaceScope, filter?: ProjectListFilter): Promise<Project[]> {
    return this.store.projects.list(scope, filter);
  }

  get(scope: WorkspaceScope, id: string): Promise<Project> {
    return this.store.projects.get(scope, id);
  }

  progress(scope: WorkspaceScope): Promise<Record<string, ProjectProgress>> {
    return this.store.projects.progress(scope);
  }

  /** Writes sort order; rows outside the workspace are left untouched by the store. */
  reorder(scope: WorkspaceScope, items: ProjectReorderItem[]): Promise<void> {
    if (items.length === 0) return Promise.resolve();
    return this.store.projects.reorder(scope, items);
  }

  /** Completed tasks with outcomes, oldest first. */
  async progressLog(scope: WorkspaceScope, projectId: string): Promise<ProjectProgressEntry[]> {
    await this.store.projects.get(scope, projectId);
    const done = await this.store.tasks.list(scope, { projectId, status: 'done' });
    return done
      .filter((task) => typeof task.outcome === 'string' && task.outcome.length > 0)
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
      .map((task) => {
        const meta = (task.metadata ?? {}) as Record<string, unknown>;
        return {
          id: task.id,
          timestamp: task.updated_at,
          agent: task.assignee ?? 'unknown',
          task_title: task.title,
          task_id: task.id,
          outcome: task.outcome as string,
          sprint: typeof meta.sprint === 'number' ? meta.sprint : null,
        };
      });
  }

  async create(
    scope: WorkspaceScope,
    input: ProjectCreateInput,
    actor: ActorContext,
  ): Promise<Project> {
    const verdict = await this.gate.check('project.create', { scope, userId: actor.userId });
    if (!verdict.allowed) {
      throw new GateDenied('project.create', verdict.reason, {
        status: verdict.status,
        upgradeUrl: verdict.upgradeUrl,
        details: verdict.details,
      });
    }

    await this.assertGroupInScope(scope, input.group_id);
    const name = await this.deduplicateName(scope, input.name);
    const project = await this.store.projects.create(scope, { ...input, name });

    await this.store.activity.append(scope, {
      event_type: 'project.created',
      severity: 'info',
      source: actor.source,
      title: `Project created: ${project.name}`,
      actor_user_id: actor.userId ?? null,
      user_id: actor.ownerUserId ?? null,
      details: { project_id: project.id },
    });

    return project;
  }

  /** A group from another workspace looks the same as one that does not exist. */
  private async assertGroupInScope(
    scope: WorkspaceScope,
    groupId: string | null | undefined,
  ): Promise<void> {
    if (groupId && !(await this.store.projects.groupExists(scope, groupId))) {
      throw new NotFound('Project group', groupId);
    }
  }

  async update(
    scope: WorkspaceScope,
    id: string,
    patch: ProjectPatch,
    actor: ActorContext,
  ): Promise<Project> {
    await this.store.projects.get(scope, id);
    await this.assertGroupInScope(scope, patch.group_id);
    const next: ProjectPatch = { ...patch };
    if (next.name) {
      next.name = await this.deduplicateName(scope, next.name, id);
    }
    const project = await this.store.projects.update(scope, id, next);
    await this.store.activity.append(scope, {
      event_type: 'project.updated',
      severity: 'info',
      source: actor.source,
      title: `Project updated: ${project.name ?? id}`,
      actor_user_id: actor.userId ?? null,
      user_id: actor.ownerUserId ?? null,
      details: { project_id: id },
    });
    return project;
  }

  async delete(scope: WorkspaceScope, id: string, actor: ActorContext): Promise<void> {
    const project = await this.store.projects.get(scope, id);
    await this.store.projects.delete(scope, id);
    await this.store.activity.append(scope, {
      event_type: 'project.deleted',
      severity: 'warning',
      source: actor.source,
      title: `Project deleted: ${project?.name ?? id}`,
      actor_user_id: actor.userId ?? null,
      user_id: actor.ownerUserId ?? null,
      details: { project_id: id },
    });
  }

  /** Appends v2, v3, ... when the name is already taken in the workspace. */
  async deduplicateName(scope: WorkspaceScope, name: string, excludeId?: string): Promise<string> {
    const existing = await this.store.projects.list(scope, { namePrefix: name, limit: 100 });
    if (existing.length === 0) return name;

    const taken = new Set(
      existing.filter((p) => p.id !== excludeId).map((p) => p.name.toLowerCase()),
    );
    if (!taken.has(name.toLowerCase())) return name;

    let version = 2;
    while (taken.has(`${name} v${version}`.toLowerCase())) version++;
    return `${name} v${version}`;
  }
}
