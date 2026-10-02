import { describe, expect, it } from 'vitest';
import { DependencyError } from '../errors.ts';
import { createScope } from '../scope.ts';
import { validateDependencies } from '../tasks/dependencies.ts';
import { InMemoryStore } from '../testing/memory-store.ts';

const scopeA = createScope({ workspaceId: 'ws-a', orgId: 'org-a', actorId: 'user-a' });
const scopeB = createScope({ workspaceId: 'ws-b', orgId: 'org-b', actorId: 'user-b' });

describe('validateDependencies', () => {
  it('accepts an empty list', async () => {
    const store = new InMemoryStore();
    await expect(validateDependencies(store.tasks, scopeA, 't1', [])).resolves.toBeUndefined();
  });

  it('rejects a self reference', async () => {
    const store = new InMemoryStore();
    const t = store.seedTask(scopeA, { title: 'a' });
    await expect(validateDependencies(store.tasks, scopeA, t.id, [t.id])).rejects.toThrow(
      'A task cannot depend on itself',
    );
  });

  it('rejects dependencies that are missing from the workspace', async () => {
    const store = new InMemoryStore();
    const t = store.seedTask(scopeA, { title: 'a' });
    const other = store.seedTask(scopeB, { title: 'b' });
    await expect(
      validateDependencies(store.tasks, scopeA, t.id, [other.id]),
    ).rejects.toBeInstanceOf(DependencyError);
  });

  it('rejects a depth-1 cycle', async () => {
    const store = new InMemoryStore();
    const a = store.seedTask(scopeA, { title: 'a' });
    const b = store.seedTask(scopeA, { title: 'b', depends_on: [a.id] });
    await expect(validateDependencies(store.tasks, scopeA, a.id, [b.id])).rejects.toThrow(
      /Circular dependency/,
    );
  });

  it('accepts valid dependencies and dedupes the list', async () => {
    const store = new InMemoryStore();
    const a = store.seedTask(scopeA, { title: 'a' });
    const b = store.seedTask(scopeA, { title: 'b' });
    await expect(
      validateDependencies(store.tasks, scopeA, a.id, [b.id, b.id]),
    ).resolves.toBeUndefined();
  });

  it('checks existence for new tasks without a cycle check', async () => {
    const store = new InMemoryStore();
    const a = store.seedTask(scopeA, { title: 'a' });
    await expect(validateDependencies(store.tasks, scopeA, null, [a.id])).resolves.toBeUndefined();
  });
});
