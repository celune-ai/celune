/**
 * Agent name consistency check.
 *
 * Verifies that all agent name references stay in sync across:
 *   - agents-data.ts (canonical source)
 *   - TASK_ASSIGNEES / TASK_ASSIGNEE_LABELS in @repo/types
 *   - AGENT_COLORS in agents-data.ts
 *   - AGENT_SHORT_NAMES in task-cli.mjs
 *
 * Run with: pnpm test
 *
 * Source: Agent System Optimization V1 retro (be7b0993)
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { AGENTS, AGENT_COLORS } from '../agents-data';
import { TASK_ASSIGNEES, TASK_ASSIGNEE_LABELS } from '@repo/types';

// Derived sets from the canonical source
const agentIds = AGENTS.map((a) => a.id);

const REPO_ROOT = resolve(__dirname, '../../../../..');

describe('agent name consistency', () => {
  describe('TASK_ASSIGNEES vs agents-data.ts', () => {
    it('contains all agent IDs from agents-data.ts plus unassigned', () => {
      const expected = ['unassigned', ...agentIds];
      for (const id of expected) {
        expect(TASK_ASSIGNEES).toContain(id);
      }
    });

    it('has no orphaned entries not in agents-data.ts', () => {
      const allowed = new Set(['unassigned', ...agentIds]);
      const orphaned = [...TASK_ASSIGNEES].filter((id) => !allowed.has(id));
      expect(orphaned).toEqual([]);
    });
  });

  describe('TASK_ASSIGNEE_LABELS vs TASK_ASSIGNEES', () => {
    it('has a label for every assignee', () => {
      for (const id of TASK_ASSIGNEES) {
        expect(TASK_ASSIGNEE_LABELS).toHaveProperty(id);
        expect(TASK_ASSIGNEE_LABELS[id]).toBeTruthy();
      }
    });
  });

  describe('AGENT_COLORS vs agents-data.ts', () => {
    it('has a color entry for every agent ID', () => {
      for (const id of agentIds) {
        expect(AGENT_COLORS).toHaveProperty(id);
      }
    });

    it('has no orphaned color entries not in agents-data.ts', () => {
      const knownIds = new Set(agentIds);
      const orphaned = Object.keys(AGENT_COLORS).filter((id) => !knownIds.has(id));
      expect(orphaned).toEqual([]);
    });
  });

  describe('AGENT_SHORT_NAMES in task-cli.mjs', () => {
    it('contains all agent IDs from agents-data.ts', () => {
      const cliPath = resolve(REPO_ROOT, 'packages/db/scripts/task-cli.mjs');
      expect(existsSync(cliPath), 'task-cli.mjs not found').toBe(true);

      const source = readFileSync(cliPath, 'utf-8');

      // Extract the AGENT_SHORT_NAMES block
      const match = source.match(/const AGENT_SHORT_NAMES\s*=\s*\{([^}]+)\}/);
      expect(match, 'AGENT_SHORT_NAMES block not found in task-cli.mjs').toBeTruthy();

      const block = match![1];
      const definedKeys = [...block.matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]);

      for (const id of agentIds) {
        expect(definedKeys, `AGENT_SHORT_NAMES missing agent "${id}"`).toContain(id);
      }
    });
  });
});
