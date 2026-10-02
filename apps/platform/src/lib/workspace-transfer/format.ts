/**
 * celune-workspace v1: a full workspace export. Carries project groups,
 * projects, tasks (with comments, dependencies, and attachment metadata),
 * agent configs, workspace settings, and the celune-brain v1 document.
 *
 * Every table is read through a column allowlist, every JSON column is
 * passed through scrubSecrets, and key-shaped values inside text are
 * redacted, so provider keys, API keys, tokens, and encrypted columns never
 * leave the source instance.
 */
import { z } from 'zod';
import { BrainTransferError, parseExportFile, type BrainExportFile } from '@/lib/brain-transfer';
import { API_KEY_PREFIX } from '@/lib/api-keys';

export const WORKSPACE_EXPORT_FORMAT = 'celune-workspace';
export const WORKSPACE_FORMAT_VERSION = 1;
export const SUPPORTED_WORKSPACE_VERSIONS: readonly number[] = [1];

/** Upload cap for the request body as sent (JSON, gzip, or zip). */
export const MAX_WORKSPACE_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Cap on bytes after gzip or zip expansion. */
export const MAX_WORKSPACE_EXPANDED_BYTES = 200 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 5000;
export const ATTACHMENTS_BUCKET = 'task-attachments';

export const ZIP_EXPORT_ENTRY = 'workspace.json';
export const ZIP_ATTACHMENT_DIR = 'attachments/';

export { BrainTransferError as WorkspaceTransferError };

export const GROUP_COLUMNS = [
  'id',
  'name',
  'description',
  'sort_order',
  'branch',
  'base_branch',
  'pr_url',
  'pr_number',
  'created_at',
  'updated_at',
] as const;

export const PROJECT_COLUMNS = [
  'id',
  'name',
  'description',
  'status',
  'category',
  'target_date',
  'vault_path',
  'metadata',
  'group_id',
  'project_type',
  'priority',
  'prd_content',
  'prd_metadata',
  'sort_order',
  'created_at',
  'updated_at',
] as const;

export const TASK_COLUMNS = [
  'id',
  'title',
  'description',
  'outcome',
  'status',
  'priority',
  'assignee',
  'project_id',
  'category',
  'due_date',
  'source',
  'source_ref',
  'vault_path',
  'time_estimate_minutes',
  'time_spent_minutes',
  'subtasks',
  'metadata',
  'parent_id',
  'spawned_by',
  'context_keys',
  'depends_on',
  'effort',
  'success_criteria',
  'sort_order',
  'created_at',
  'updated_at',
  'completed_at',
  'archived_at',
] as const;

export const COMMENT_COLUMNS = ['id', 'task_id', 'author', 'content', 'created_at'] as const;

/** storage_path is read for the zip but never written to the export document. */
export const ATTACHMENT_COLUMNS = [
  'id',
  'task_id',
  'file_name',
  'file_size',
  'mime_type',
  'uploaded_by',
  'created_at',
] as const;

export const AGENT_CONFIG_COLUMNS = [
  'agent_id',
  'parameters',
  'active_profile',
  'permissions',
  'voice_settings',
  'display_name',
  'role',
  'description',
  'agent_type',
  'model',
  'color',
  'icon',
  'capabilities',
  'is_active',
  'persona_prompt',
  'contract_schema',
  'budget_cap_usd',
  'pod',
  'is_lead',
  'created_at',
  'updated_at',
] as const;

/** Workspace columns that travel. Name is informational and never applied on import. */
export const SETTINGS_COLUMNS = [
  'name',
  'description',
  'icon',
  'color_scheme',
  'brain_settings',
] as const;

/** JSON columns that hold schemas or checklists: keys are kept, secret values are still dropped. */
export const VALUE_ONLY_JSON_COLUMNS = new Set(['contract_schema', 'success_criteria', 'subtasks']);

const SECRET_KEY =
  /(apikey|api_key|access_key|signing_key|secret|password|passwd|passphrase|private_key|credential|webhook_url|authorization|bearer|cookie|encrypted|^enc_|_enc$|_key$)/;
const TOKEN_KEY = /(^|_)(token|dsn|auth)($|_)/;
const SECRET_PREFIXES =
  'sk-|sk_live_|sk_test_|rk_live_|xox[abprs]-|xapp-|ghp_|gho_|ghs_|ghu_|github_pat_|glpat-|AIza';
const HOST_KEY_PREFIX = `${API_KEY_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_live_`;
const SECRET_VALUE = new RegExp(`^(${SECRET_PREFIXES}|AKIA[0-9A-Z]{12}|${HOST_KEY_PREFIX})`);
const SECRET_IN_TEXT = new RegExp(
  `(?<![A-Za-z0-9])(?:(?:${SECRET_PREFIXES}|${HOST_KEY_PREFIX})[A-Za-z0-9_\\-]{8,}|AKIA[0-9A-Z]{16})`,
  'g',
);

/** Normalizes camelCase, kebab, dotted, and spaced names to snake_case before matching. */
export function isSecretKey(key: string): boolean {
  const snake = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-.\s]+/g, '_')
    .toLowerCase();
  return SECRET_KEY.test(snake) || TOKEN_KEY.test(snake);
}

export function isSecretValue(value: string): boolean {
  return SECRET_VALUE.test(value);
}

/** Replaces key-shaped substrings inside free text. */
export function redactSecrets(text: string): string {
  return text.replace(SECRET_IN_TEXT, '[redacted]');
}

function scrubString(value: string): string | undefined {
  return isSecretValue(value) ? undefined : redactSecrets(value);
}

/** Drops secret-looking keys and values from a JSON value, recursively. */
export function scrubSecrets(value: unknown, keepKeys = false): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) {
    return value.map((v) => scrubSecrets(v, keepKeys)).filter((v) => v !== undefined);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (!keepKeys && isSecretKey(k)) continue;
      const cleaned = scrubSecrets(v, keepKeys);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return value;
}

/** Keeps allowlisted columns and scrubs JSON columns. */
export function pickRow(
  row: Record<string, unknown>,
  columns: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns) {
    if (!(col in row)) continue;
    const value = row[col];
    if (value && typeof value === 'object') {
      out[col] = scrubSecrets(value, VALUE_ONLY_JSON_COLUMNS.has(col));
    } else if (typeof value === 'string') {
      out[col] = scrubString(value) ?? null;
    } else {
      out[col] = value;
    }
  }
  return out;
}

const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'must be a UUID');
const isoDate = z.string().max(64);
const json = z.unknown();

const groupSchema = z.object({
  id: uuid,
  name: z.string().min(1).max(500),
  description: z.string().nullable().optional(),
  sort_order: z.number().int().optional(),
  branch: z.string().max(500).nullable().optional(),
  base_branch: z.string().max(500).nullable().optional(),
  pr_url: z.string().max(2000).nullable().optional(),
  pr_number: z.number().int().nullable().optional(),
  created_at: isoDate.optional(),
  updated_at: isoDate.optional(),
});

const projectSchema = z.object({
  id: uuid,
  name: z.string().min(1).max(500),
  description: z.string().nullable().optional(),
  status: z.string().max(50).optional(),
  category: z.string().max(200).nullable().optional(),
  target_date: z.string().max(64).nullable().optional(),
  vault_path: z.string().max(2000).nullable().optional(),
  metadata: json.optional(),
  group_id: uuid.nullable().optional(),
  project_type: z.string().max(50).nullable().optional(),
  priority: z.string().max(50).nullable().optional(),
  prd_content: z.string().nullable().optional(),
  prd_metadata: json.optional(),
  sort_order: z.number().int().optional(),
  created_at: isoDate.optional(),
  updated_at: isoDate.optional(),
});

const taskSchema = z.object({
  id: uuid,
  title: z.string().min(1).max(2000),
  description: z.string().nullable().optional(),
  outcome: z.string().nullable().optional(),
  status: z.string().max(50).optional(),
  priority: z.string().max(50).optional(),
  assignee: z.string().max(200).optional(),
  project_id: uuid.nullable().optional(),
  category: z.array(z.string().max(200)).nullable().optional(),
  due_date: z.string().max(64).nullable().optional(),
  source: z.string().max(200).nullable().optional(),
  source_ref: z.string().max(2000).nullable().optional(),
  vault_path: z.string().max(2000).nullable().optional(),
  time_estimate_minutes: z.number().int().nullable().optional(),
  time_spent_minutes: z.number().int().nullable().optional(),
  subtasks: json.optional(),
  metadata: json.optional(),
  parent_id: uuid.nullable().optional(),
  spawned_by: z.string().max(200).nullable().optional(),
  context_keys: z.array(z.string().max(500)).nullable().optional(),
  depends_on: z.array(uuid).nullable().optional(),
  effort: z.string().max(10).nullable().optional(),
  success_criteria: json.optional(),
  sort_order: z.number().int().optional(),
  created_at: isoDate.optional(),
  updated_at: isoDate.optional(),
  completed_at: isoDate.nullable().optional(),
  archived_at: isoDate.nullable().optional(),
});

const commentSchema = z.object({
  id: uuid,
  task_id: uuid,
  author: z.string().min(1).max(200),
  content: z.string(),
  created_at: isoDate.optional(),
});

const attachmentSchema = z.object({
  id: uuid,
  task_id: uuid,
  file_name: z.string().min(1).max(300),
  file_size: z.number().int().nonnegative(),
  mime_type: z.string().max(200),
  uploaded_by: z.string().max(200),
  created_at: isoDate.optional(),
});

const agentConfigSchema = z.object({
  agent_id: z.string().min(1).max(200),
  parameters: json.optional(),
  active_profile: z.string().max(200).optional(),
  permissions: json.optional(),
  voice_settings: json.optional(),
  display_name: z.string().max(200).nullable().optional(),
  role: z.string().max(500).nullable().optional(),
  description: z.string().nullable().optional(),
  agent_type: z.string().max(100).nullable().optional(),
  model: z.string().max(200).nullable().optional(),
  color: z.string().max(100).nullable().optional(),
  icon: z.string().max(200).nullable().optional(),
  capabilities: json.optional(),
  is_active: z.boolean().nullable().optional(),
  persona_prompt: z.string().nullable().optional(),
  contract_schema: json.optional(),
  budget_cap_usd: z.number().nullable().optional(),
  pod: z.string().max(100).nullable().optional(),
  is_lead: z.boolean().nullable().optional(),
  created_at: isoDate.optional(),
  updated_at: isoDate.optional(),
});

const settingsSchema = z.object({
  name: z.string().max(500).optional(),
  description: z.string().nullable().optional(),
  icon: z.string().max(200).nullable().optional(),
  color_scheme: z.string().max(100).nullable().optional(),
  brain_settings: json.optional(),
});

const workspaceFileSchema = z.object({
  format: z.literal(WORKSPACE_EXPORT_FORMAT),
  format_version: z.number().int(),
  exported_at: z.string().optional(),
  source: z
    .object({ workspace_id: z.string().optional(), edition: z.string().optional() })
    .optional(),
  counts: z.record(z.string(), z.number()).optional(),
  settings: settingsSchema.default({}),
  project_groups: z.array(groupSchema).default([]),
  projects: z.array(projectSchema).default([]),
  tasks: z.array(taskSchema).default([]),
  task_comments: z.array(commentSchema).default([]),
  task_attachments: z.array(attachmentSchema).default([]),
  agent_configs: z.array(agentConfigSchema).default([]),
  brain: z.unknown().optional(),
});

export type GroupRow = z.infer<typeof groupSchema>;
export type ProjectRow = z.infer<typeof projectSchema>;
export type TaskRow = z.infer<typeof taskSchema>;
export type CommentRow = z.infer<typeof commentSchema>;
export type AttachmentRow = z.infer<typeof attachmentSchema>;
export type AgentConfigRow = z.infer<typeof agentConfigSchema>;
export type WorkspaceSettings = z.infer<typeof settingsSchema>;

export type WorkspaceExportFile = Omit<z.infer<typeof workspaceFileSchema>, 'brain'> & {
  brain: BrainExportFile | null;
};

/**
 * Validates an uploaded workspace document. The version is checked before the
 * full schema so a newer file gets a version error, and the nested brain is
 * validated by the brain importer's own version and schema checks.
 */
export function parseWorkspaceFile(input: unknown): WorkspaceExportFile {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BrainTransferError(
      'invalid_workspace_export',
      'Body must be a workspace export document',
    );
  }
  const doc = input as Record<string, unknown>;
  if (doc.format !== WORKSPACE_EXPORT_FORMAT) {
    throw new BrainTransferError(
      'invalid_workspace_export',
      `Unrecognized export format. Expected format "${WORKSPACE_EXPORT_FORMAT}"`,
    );
  }
  const version = doc.format_version;
  if (typeof version !== 'number' || !SUPPORTED_WORKSPACE_VERSIONS.includes(version)) {
    throw new BrainTransferError(
      'unsupported_format_version',
      `Unsupported workspace export format_version ${String(version)}. This server supports: ${SUPPORTED_WORKSPACE_VERSIONS.join(', ')}`,
    );
  }
  const parsed = workspaceFileSchema.safeParse(doc);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path?.length ? ` at ${issue.path.join('.')}` : '';
    throw new BrainTransferError(
      'invalid_workspace_export',
      `Invalid workspace export file${where}: ${issue?.message ?? 'schema mismatch'}`,
    );
  }
  const { brain, ...rest } = parsed.data;
  return { ...rest, brain: brain == null ? null : parseExportFile(brain) };
}
