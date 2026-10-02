import { describe, it, expect } from 'vitest';
import { AGENTS, AGENT_COLORS } from '../agents-data';
import { TASK_ASSIGNEES, TASK_ASSIGNEE_LABELS } from '@repo/types';

/**
 * Ensures agent name references stay consistent across all canonical sources.
 *
 * Canonical sources:
 *   1. agents-data.ts → AGENTS[].id  (source of truth for agent identity)
 *   2. agents-data.ts → AGENT_COLORS  (visual identity per agent)
 *   3. @repo/types → TASK_ASSIGNEES   (valid assignee values for tasks)
 *   4. @repo/types → TASK_ASSIGNEE_LABELS (display names for assignees)
 */
describe('Agent name consistency', () => {
  const agentIds = AGENTS.map((a) => a.id).sort();
  const assignees = [...TASK_ASSIGNEES].sort();
  const colorKeys = Object.keys(AGENT_COLORS).sort();
  const labelKeys = Object.keys(TASK_ASSIGNEE_LABELS).sort();

  it('AGENTS covers every TASK_ASSIGNEE (excluding "unassigned")', () => {
    const assigneesWithoutUnassigned = assignees.filter((a) => a !== 'unassigned');
    expect(agentIds).toEqual(assigneesWithoutUnassigned);
  });

  it('AGENT_COLORS has an entry for every agent', () => {
    expect(colorKeys).toEqual(agentIds);
  });

  it('TASK_ASSIGNEE_LABELS has an entry for every TASK_ASSIGNEE', () => {
    expect(labelKeys).toEqual(assignees);
  });

  it('every AGENT has a non-empty id, name, and role', () => {
    for (const agent of AGENTS) {
      expect(agent.id, `Agent missing id`).toBeTruthy();
      expect(agent.name, `Agent ${agent.id} missing name`).toBeTruthy();
      expect(agent.role, `Agent ${agent.id} missing role`).toBeTruthy();
    }
  });

  it('no duplicate agent IDs', () => {
    const ids = AGENTS.map((a) => a.id);
    expect(ids).toEqual([...new Set(ids)]);
  });

  it('TASK_ASSIGNEE_LABELS display names match AGENTS.name for AI agents', () => {
    for (const agent of AGENTS) {
      if (agent.type !== 'ai') continue;
      const label = TASK_ASSIGNEE_LABELS[agent.id as keyof typeof TASK_ASSIGNEE_LABELS];
      expect(label, `Label mismatch for ${agent.id}`).toBe(agent.name);
    }
  });
});
