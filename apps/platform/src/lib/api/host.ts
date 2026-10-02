/**
 * Platform wiring for @celuneai/api: the host hooks (api_keys lookup, workspace
 * membership, agent employment, job crypto, callbacks), the authenticator, and
 * one Hono app mounted under /api/v1.
 */

import {
  createApi,
  createAuthenticator,
  jwtConfigFromEnv,
  type ApiHost,
  type ApiKeyLookup,
  type ApiKeyRecord,
  type Authenticator,
  type TaskContextEntry,
} from '@celuneai/api';
import { createActivity, getAgentMemoryByKeys } from '@repo/db/queries';
import { createServiceClient } from '@repo/db/service';
import { getEmployedAgents, isAgentEmployed } from '@/lib/agent-employment';
import { dispatchJobCallback } from '@/lib/ai-job-queue/callbacks';
import { decryptPayload, encryptPayload, verifyJobHmac } from '@/lib/ai-job-queue/crypto';
import { getCoreServices } from '@/lib/core';
import { enqueueServerRun } from '@/lib/execution/queue-manager';
import { hostConfig } from '@/lib/host-config';
import { getInstructions } from '@/lib/mcp/instructions-cache';
import { PLATFORM_EXTRA_TOOLS } from '@/lib/mcp/registry';
import { resolveWorkspaceAccess } from '@/lib/mcp/workspace-resolver';
import { checkRateLimit } from '@/lib/rate-limiter';
import { runTaskCreatedEffects, runTaskUpdatedEffects } from '@/lib/tasks/task-effects';
import { getTaskUsage } from '@/lib/tasks/task-usage';

const KEY_COLUMNS =
  'id, workspace_id, org_id, user_id, key_hash, scopes, environment, expires_at, revoked_at, rate_limit_per_minute, realtime_enabled';

function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex.startsWith('\\x') ? hex.slice(2) : hex, 'hex');
}

export const platformApiKeys: ApiKeyLookup = {
  async findByPrefix(prefix) {
    const { data, error } = await createServiceClient()
      .from('api_keys')
      .select(KEY_COLUMNS)
      .eq('key_prefix', prefix);
    if (error) throw new Error(`api_keys lookup failed: ${error.message}`);
    return (data ?? []) as unknown as ApiKeyRecord[];
  },
  async checkRateLimit(record) {
    const limit = record.rate_limit_per_minute ?? 60;
    const rl = await checkRateLimit(`apikey:${record.id}`, limit, 60_000);
    return {
      allowed: rl.allowed,
      limit,
      resetAt: rl.resetAt,
      retryAfterSeconds: Math.max(0, Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000)),
    };
  },
  touch(record) {
    void createServiceClient()
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', record.id)
      .then(({ error }) => {
        if (error)
          console.warn(
            `Failed to update api_key last_used_at for key ${record.id}:`,
            error.message,
          );
      });
  },
};

export const platformHost: ApiHost = {
  async resolveWorkspace(auth, workspaceId) {
    return resolveWorkspaceAccess(auth, workspaceId, createServiceClient());
  },
  jobs: {
    crypto: {
      decrypt: (encryptedHex, ivHex) =>
        decryptPayload(hexToBuffer(encryptedHex), hexToBuffer(ivHex)),
      encrypt: (plaintext) => {
        const { encrypted, iv } = encryptPayload(plaintext);
        return {
          result_encrypted: '\\x' + encrypted.toString('hex'),
          result_iv: '\\x' + iv.toString('hex'),
        };
      },
      verifyHmac: verifyJobHmac,
    },
    onCompleted: async (_scope, jobId) => {
      await dispatchJobCallback(createServiceClient(), jobId);
    },
  },
  agents: {
    isEmployed: isAgentEmployed,
    listEmployed: async (workspaceId) =>
      (await getEmployedAgents(workspaceId)).map((a) => ({
        agent_id: a.agent_id,
        display_name: a.display_name,
        role: a.role,
        agent_type: a.agent_type,
      })),
  },
  async describeWorkspace(_auth, workspaceId) {
    const { data } = await createServiceClient()
      .from('workspaces')
      .select('id, name, slug, is_default, created_at')
      .eq('id', workspaceId)
      .maybeSingle();
    return data ?? null;
  },
  tasks: {
    async onChange(change) {
      if (change.kind === 'created') {
        runTaskCreatedEffects(change.task, change.actor.userId ?? '');
        return;
      }
      await runTaskUpdatedEffects(change, createServiceClient(), change.scope.workspaceId);
    },
    async context(scope, keys) {
      const rows = await getAgentMemoryByKeys(createServiceClient(), keys, {
        workspace_id: scope.workspaceId,
      });
      return rows as unknown as TaskContextEntry[];
    },
    usage: (_scope, taskId) => getTaskUsage(createServiceClient(), taskId),
  },
  executions: {
    async enqueue({ scope, task, agentId, userId }) {
      const orgId = task.org_id ?? scope.orgId;
      if (!orgId) return null;
      const { job, error } = await enqueueServerRun({
        workspaceId: scope.workspaceId,
        userId,
        orgId,
        targetType: 'task',
        taskId: task.id,
        agentId,
        priority: task.priority === 'urgent' ? 10 : task.priority === 'high' ? 5 : 0,
        context: {
          task_title: task.title,
          task_description: task.description,
          task_priority: task.priority,
          project_id: task.project_id,
        },
      });
      if (!job && error) console.warn('[initiate] execution enqueue skipped:', error);
      return job ? { id: job.id } : null;
    },
  },
  onToolCall({ auth, tool, workspaceId }) {
    createActivity(createServiceClient(), {
      event_type: `mcp.tool.${tool}`,
      severity: 'info',
      source: 'mcp',
      title: `MCP tool called: ${tool}`,
      details: { tool, key_id: auth.keyId, principal: auth.principal },
      workspace_id: workspaceId,
    }).catch(() => {
      /* non-blocking */
    });
  },
};

export const authenticateRequest: Authenticator = createAuthenticator({
  apiKeyPrefix: hostConfig.apiKeyPrefix,
  apiKeys: platformApiKeys,
  jwt: jwtConfigFromEnv(process.env),
});

export function platformServices() {
  return getCoreServices(createServiceClient());
}

let app: ReturnType<typeof createApi> | null = null;

/** The /api/v1 surface: REST handlers plus MCP, sharing the platform host. */
export function getPlatformApi() {
  app ??= createApi({
    services: platformServices,
    authenticate: authenticateRequest,
    host: platformHost,
    basePath: '/api/v1',
    mcp: {
      instructions: getInstructions,
      extraTools: PLATFORM_EXTRA_TOOLS,
      extendContext: (ctx) => ({ ...ctx, supabase: createServiceClient() }),
      serverInfo: { name: hostConfig.productName.toLowerCase(), version: '1.0.0' },
    },
  });
  return app;
}
