// ---------------------------------------------------------------------------
// Integration types — shared across admin app and API routes
// ---------------------------------------------------------------------------

/** All supported integration identifiers */
export type IntegrationId =
  // Source Control
  | 'github'
  | 'gitlab'
  | 'bitbucket'
  // Communication
  | 'slack'
  | 'discord'
  | 'microsoft_teams'
  | 'telegram'
  | 'sms_telecom'
  // AI Providers
  | 'anthropic'
  | 'openai'
  | 'elevenlabs'
  | 'groq'
  | 'google_gemini'
  | 'mistral'
  // Project Management
  | 'linear'
  | 'jira'
  | 'asana'
  | 'notion'
  // Databases
  | 'supabase'
  | 'postgresql'
  | 'mongodb'
  | 'redis'
  | 'mysql'
  | 'neon'
  // Deployment
  | 'railway'
  | 'netlify'
  | 'cloudflare'
  // Monitoring
  | 'sentry'
  | 'datadog'
  | 'pagerduty'
  // Cloud Platforms
  | 'aws'
  | 'gcp'
  | 'azure'
  // Research & Web Data
  | 'tavily'
  | 'firecrawl'
  | 'notebooklm'
  // Design
  | 'figma'
  // Documentation
  | 'confluence'
  // Email
  | 'agentmail'
  | 'resend'
  | 'twilio'
  // Billing
  | 'stripe'
  // Automation
  | 'zapier'
  | 'make_com'
  // Commerce
  | 'shopify'
  // CRM
  | 'hubspot'
  | 'salesforce'
  // Data & Analytics
  | 'snowflake'
  | 'bigquery'
  | 'airtable'
  | 'google_analytics'
  // Testing
  | 'playwright'
  // DevOps
  | 'docker'
  | 'kubernetes'
  | 'circleci'
  | 'github_actions'
  // Feature Management
  | 'launchdarkly'
  // Scheduling
  | 'calendly'
  | 'google_calendar'
  // Storage
  | 'google_workspace'
  // IDE & CLI
  | 'cursor'
  | 'windsurf'
  | 'claude_code';

/** Grouping categories for the integrations grid */
export type IntegrationCategory =
  | 'source_control'
  | 'ai_provider'
  | 'communication'
  | 'project_management'
  | 'databases'
  | 'deployment'
  | 'monitoring'
  | 'cloud'
  | 'research'
  | 'design'
  | 'documentation'
  | 'email'
  | 'billing'
  | 'automation'
  | 'commerce'
  | 'crm'
  | 'data_analytics'
  | 'testing'
  | 'devops'
  | 'scheduling'
  | 'storage'
  | 'infrastructure'
  | 'ide';

/** How an integration connects */
export type IntegrationType = 'native' | 'mcp' | 'coming_soon';

/** Connection state of an integration */
export type IntegrationStatus = 'connected' | 'disconnected' | 'error' | 'not_configured';

/** Who can configure this integration */
export type IntegrationScope = 'workspace' | 'platform';

/** How a provider key was resolved */
export type KeySource = 'byok' | 'plan' | null;

/** Status result from the aggregation API */
export interface IntegrationStatusResult {
  id: IntegrationId;
  status: IntegrationStatus;
  details?: string;
  last_checked?: string;
  /** For AI providers: whether the active key is user-provided (BYOK) or platform (plan) */
  key_source?: KeySource;
}

/** Full integration metadata (registry entry + live status) */
export interface IntegrationMeta {
  id: IntegrationId;
  name: string;
  description: string;
  category: IntegrationCategory;
  scope: IntegrationScope;
  /** How this integration connects: native (first-party), mcp, or coming_soon */
  integration_type: IntegrationType;
  /** URL to the service's website */
  url: string;
  /** Optional health check endpoint for future automated monitoring */
  healthCheckUrl?: string;
}
