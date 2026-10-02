import type { ApiHost, ApiKeyLookup, ApiKeyRecord } from '@celuneai/api';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createJobCrypto } from './job-crypto.ts';

const KEY_COLUMNS =
  'id, workspace_id, org_id, user_id, key_hash, scopes, environment, expires_at, revoked_at, realtime_enabled, rate_limit_per_minute';

export function createApiKeyLookup(supabase: SupabaseClient): ApiKeyLookup {
  return {
    async findByPrefix(prefix) {
      const { data, error } = await supabase
        .from('api_keys')
        .select(KEY_COLUMNS)
        .eq('key_prefix', prefix);
      if (error) throw new Error(`api_keys lookup failed: ${error.message}`);
      return (data ?? []) as unknown as ApiKeyRecord[];
    },
    async touch(record) {
      await supabase
        .from('api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', record.id)
        .then(
          () => undefined,
          () => undefined,
        );
    },
  };
}

export function createHost(supabase: SupabaseClient, env: NodeJS.ProcessEnv): ApiHost {
  const masterKey = env.PROVIDER_KEY_ENCRYPTION_KEY?.trim();
  const jobHmacKey = env.JOB_HMAC_KEY?.trim() || undefined;
  return {
    jobs: masterKey ? { crypto: createJobCrypto(masterKey, jobHmacKey) } : undefined,
    async describeWorkspace(_auth, workspaceId) {
      const { data } = await supabase
        .from('workspaces')
        .select('id, name, slug, is_default, created_at')
        .eq('id', workspaceId)
        .maybeSingle();
      return data ?? null;
    },
  };
}
