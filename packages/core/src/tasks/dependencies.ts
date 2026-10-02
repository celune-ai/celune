import { DependencyError } from '../errors.ts';
import type { WorkspaceScope } from '../scope.ts';
import type { TaskStore } from '../store.ts';

/**
 * Rejects self-references, dependencies outside the workspace, and depth-1
 * cycles (a dependency that already depends on this task).
 */
export async function validateDependencies(
  tasks: TaskStore,
  scope: WorkspaceScope,
  taskId: string | null,
  dependsOn: string[],
): Promise<void> {
  const deps = Array.from(new Set(dependsOn));
  if (deps.length === 0) return;

  if (taskId && deps.includes(taskId)) {
    throw new DependencyError('A task cannot depend on itself', { taskId });
  }

  const found = await tasks.list(scope, { ids: deps, includeArchived: true });
  const foundIds = new Set(found.map((t) => t.id));
  const missing = deps.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    // 404 so ids from other workspaces look the same as ids that do not exist
    throw new DependencyError(
      `Dependency not found in this workspace: ${missing.join(', ')}`,
      { missing },
      404,
    );
  }

  if (!taskId) return;
  for (const dep of found) {
    const depDeps = (dep.depends_on ?? []) as string[];
    if (depDeps.includes(taskId)) {
      throw new DependencyError(
        `Circular dependency: task ${dep.id.slice(0, 8)} already depends on this task`,
        { taskId, dependencyId: dep.id },
      );
    }
  }
}
