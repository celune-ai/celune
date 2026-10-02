/**
 * Agent Contract — typed delegation contracts for agent spawning.
 *
 * Replaces ad-hoc prompt-based delegation with formal contracts that define
 * input/output schemas, cost ceilings, tool restrictions, and model tier.
 */

/** Model tier for agent delegation */
export type AgentModelTier = 'opus' | 'sonnet' | 'haiku';

/** Isolation mode for spawned agents */
export type AgentIsolation = 'inline' | 'worktree';

/**
 * Defines what an agent receives, what it must produce,
 * and what constraints it operates under.
 */
export interface AgentContract {
  /** Unique contract identifier (e.g., "code-reviewer-v1") */
  id: string;

  /** Human-readable name */
  name: string;

  /** Agent role this contract applies to */
  role: string;

  /** Model tier requirement */
  model_tier: AgentModelTier;

  /** Input contract: what context/data the agent receives */
  input: {
    /** Required context keys the agent needs */
    required_context: string[];
    /** Files the agent needs read access to */
    context_files?: string[];
    /** JSON schema for structured input (optional) */
    schema?: Record<string, unknown>;
  };

  /** Output contract: what the agent must produce */
  output: {
    /** Required fields in the agent's response */
    required_fields: string[];
    /** Files the agent may create or modify */
    allowed_artifacts?: string[];
    /** JSON schema for structured output (optional) */
    schema?: Record<string, unknown>;
  };

  /** Operational constraints */
  constraints: {
    /** Maximum conversation turns before timeout */
    max_turns?: number;
    /** Maximum cost in USD for this delegation */
    max_cost_usd?: number;
    /** Tool whitelist — only these tools are allowed (empty = all allowed) */
    allowed_tools?: string[];
    /** Tool blacklist — these tools are blocked */
    blocked_tools?: string[];
    /** Isolation mode */
    isolation?: AgentIsolation;
  };

  /** Permission constraints */
  permissions: {
    /** Can the agent create new Supabase tasks? */
    can_create_tasks: boolean;
    /** Can the agent modify database schema? */
    can_modify_schema: boolean;
    /** Is the agent limited to read-only operations? */
    read_only: boolean;
    /** Can the agent push to git? */
    can_push: boolean;
  };

  /** Contract version for tracking changes */
  version: string;
}

/**
 * Result of validating an agent's output against its contract.
 */
export interface ContractValidationResult {
  /** Whether the output satisfies the contract */
  valid: boolean;
  /** List of violations found */
  violations: ContractViolation[];
}

export interface ContractViolation {
  /** Which contract field was violated */
  field: string;
  /** What was expected */
  expected: string;
  /** What was found */
  actual: string;
}
