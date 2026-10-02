/**
 * Agent Contract utilities — validation and default contracts.
 *
 * Validates agent outputs against their contracts and provides
 * pre-built contracts for the standard agent roles.
 */

import type { AgentContract, ContractValidationResult, ContractViolation } from '@repo/types';

/**
 * Validate an agent's output against its contract.
 * Returns a result indicating whether the output satisfies the contract.
 */
export function validateAgentOutput(
  contract: AgentContract,
  output: Record<string, unknown>,
): ContractValidationResult {
  const violations: ContractViolation[] = [];

  // TODO: If contract.output.schema is provided, validate against it using a schema
  // validator (e.g., ajv). Currently only checks required field presence.

  // Check required output fields
  for (const field of contract.output.required_fields) {
    if (!(field in output) || output[field] === null || output[field] === undefined) {
      violations.push({
        field: `output.${field}`,
        expected: 'present and non-null',
        actual: field in output ? 'null' : 'missing',
      });
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Check if a delegation would exceed the contract's cost ceiling.
 */
export function wouldExceedCostCeiling(contract: AgentContract, currentCostUsd: number): boolean {
  const ceiling = contract.constraints.max_cost_usd;
  if (ceiling === undefined || ceiling === null) return false;
  return currentCostUsd >= ceiling;
}

/**
 * Check if a tool is allowed by the contract.
 */
export function isToolAllowed(contract: AgentContract, toolName: string): boolean {
  const { allowed_tools, blocked_tools } = contract.constraints;

  // Check blocklist first
  if (blocked_tools && blocked_tools.includes(toolName)) return false;

  // If allowlist is defined and non-empty, tool must be in it
  if (allowed_tools && allowed_tools.length > 0) {
    return allowed_tools.includes(toolName);
  }

  return true;
}

// ---------------------------------------------------------------------------
// Default contracts for standard agent roles
// ---------------------------------------------------------------------------

export const DEFAULT_CONTRACTS: Record<string, AgentContract> = {
  'code-reviewer': {
    id: 'code-reviewer-v1',
    name: 'Code Reviewer',
    role: 'code-reviewer',
    model_tier: 'sonnet',
    input: {
      required_context: ['task_id', 'project_id', 'branch'],
      context_files: [],
    },
    output: {
      required_fields: ['findings', 'verdict', 'automated_results'],
      allowed_artifacts: [],
    },
    constraints: {
      max_turns: 50,
      max_cost_usd: 5.0,
      blocked_tools: ['Write'],
      isolation: 'inline',
    },
    permissions: {
      can_create_tasks: true,
      can_modify_schema: false,
      read_only: true,
      can_push: false,
    },
    version: '1.0.0',
  },

  designer: {
    id: 'designer-v1',
    name: 'Designer',
    role: 'designer',
    model_tier: 'sonnet',
    input: {
      required_context: ['task_id', 'project_id'],
    },
    output: {
      required_fields: ['findings', 'verdict'],
    },
    constraints: {
      max_turns: 30,
      max_cost_usd: 3.0,
      blocked_tools: ['Write', 'Edit'],
      isolation: 'inline',
    },
    permissions: {
      can_create_tasks: true,
      can_modify_schema: false,
      read_only: true,
      can_push: false,
    },
    version: '1.0.0',
  },

  researcher: {
    id: 'researcher-v1',
    name: 'Researcher',
    role: 'researcher',
    model_tier: 'haiku',
    input: {
      required_context: ['task_id', 'research_question'],
    },
    output: {
      required_fields: ['findings', 'sources'],
    },
    constraints: {
      max_turns: 40,
      max_cost_usd: 1.0,
      allowed_tools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
      isolation: 'inline',
    },
    permissions: {
      can_create_tasks: false,
      can_modify_schema: false,
      read_only: true,
      can_push: false,
    },
    version: '1.0.0',
  },

  pm: {
    id: 'pm-v1',
    name: 'Project Manager',
    role: 'pm',
    model_tier: 'sonnet',
    input: {
      required_context: ['task_id', 'project_id'],
    },
    output: {
      required_fields: ['document', 'action_items'],
    },
    constraints: {
      max_turns: 40,
      max_cost_usd: 3.0,
      isolation: 'inline',
    },
    permissions: {
      can_create_tasks: true,
      can_modify_schema: false,
      read_only: false,
      can_push: false,
    },
    version: '1.0.0',
  },

  builder: {
    id: 'builder-v1',
    name: 'Builder',
    role: 'builder',
    model_tier: 'opus',
    input: {
      required_context: ['task_id', 'project_id', 'branch'],
    },
    output: {
      required_fields: ['outcome', 'files_changed'],
    },
    constraints: {
      max_turns: 100,
      max_cost_usd: 10.0,
      isolation: 'worktree',
    },
    permissions: {
      can_create_tasks: true,
      can_modify_schema: true,
      read_only: false,
      can_push: true,
    },
    version: '1.0.0',
  },
};

/**
 * Get the default contract for a given agent role.
 * Returns undefined if no default contract exists.
 */
export function getDefaultContract(role: string): AgentContract | undefined {
  return DEFAULT_CONTRACTS[role];
}
