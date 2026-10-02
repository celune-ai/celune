// ── Provider Key Types ────────────────────────────────────────────────────

export const SUPPORTED_PROVIDERS = [
  'anthropic',
  'openai',
  'elevenlabs',
  'groq',
  'google_gemini',
  'mistral',
] as const;

export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

// ── API Key Types ──────────────────────────────────────────────────────────

export type ApiKeyEnvironment = 'live' | 'test';

export type ApiKeyScope = 'read' | 'write' | 'admin';

export interface ApiKey {
  id: string;
  workspace_id: string;
  org_id: string | null;
  user_id: string;
  name: string;
  key_prefix: string;
  environment: ApiKeyEnvironment;
  /** @deprecated Use permission_scopes instead */
  scopes: ApiKeyScope[];
  /** Granular permission keys (e.g., 'tasks:read', 'projects:create') */
  permission_scopes: string[] | null;
  rate_limit_per_minute: number;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  /** When true, MCP connections receive real-time workspace events via SSE */
  realtime_enabled: boolean;
  /** MCP client identity captured from initialize messages and User-Agent */
  client_metadata: {
    name?: string;
    version?: string;
    /** IDE subscription plan (e.g. "Max", "Pro", "API Key") — reported by client or set manually */
    plan?: string;
    user_agent?: string;
    updated_at?: string;
  } | null;
  created_at: string;
  updated_at: string;
}

/** Returned only once on creation — includes the full plaintext key */
export interface ApiKeyCreated extends ApiKey {
  plaintext_key: string;
}

export interface ApiKeyInsert {
  workspace_id: string;
  org_id?: string | null;
  name: string;
  environment?: ApiKeyEnvironment;
  /** @deprecated Use permission_scopes instead */
  scopes?: ApiKeyScope[];
  /** Granular permission keys for this API key */
  permission_scopes?: string[];
  rate_limit_per_minute?: number;
  expires_at?: string | null;
}
