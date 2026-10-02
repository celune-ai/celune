/**
 * packages/notifications/src/types.ts
 *
 * Canonical types for the notification service.
 * These match the notification_preferences and slack_connections DB tables.
 */

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export const EVENT_TYPES = [
  'task.completed',
  'task.assigned',
  'task.blocked',
  'review.requested',
  'review.completed',
  'agent.status_changed',
  'deploy.triggered',
  'deploy.completed',
  'digest.weekly',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export const NOTIFICATION_CHANNELS = ['slack', 'email', 'discord', 'teams', 'telegram'] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const ACTIVE_CHANNELS: NotificationChannel[] = ['slack', 'email'];
export const COMING_SOON_CHANNELS: NotificationChannel[] = ['discord', 'teams', 'telegram'];

// ---------------------------------------------------------------------------
// Frequency
// ---------------------------------------------------------------------------

export type NotificationFrequency = 'immediate' | 'digest_daily' | 'digest_weekly' | 'off';

// ---------------------------------------------------------------------------
// Core event payload
// ---------------------------------------------------------------------------

export interface NotificationEvent {
  /** Event type string, e.g. 'task.completed' */
  type: EventType | string;
  /** Celune workspace ID */
  workspaceId: string;
  /** Agent short name that triggered the event, e.g. 'rick', 'scan' */
  actorAgent?: string;
  /** Event-specific data. Keys depend on event type. */
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// DB row shapes (read from DB)
// ---------------------------------------------------------------------------

export interface NotificationPreference {
  id: string;
  user_id: string;
  workspace_id: string;
  channel: NotificationChannel;
  event_types: string[];
  slack_channel: string | null;
  email_address: string | null;
  frequency: NotificationFrequency;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface SlackConnection {
  id: string;
  workspace_id: string;
  slack_team_id: string;
  slack_team_name: string;
  slack_channel: string | null;
  slack_channel_id: string | null;
  incoming_webhook_url: string | null;
  encrypted_webhook_url: string | null;
  webhook_iv: string | null;
  connected_by: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Bot token fields (multi-tenant distribution)
  bot_token_encrypted: string | null;
  bot_token_iv: string | null;
  bot_user_id: string | null;
  installed_scopes: string[] | null;
  app_id: string | null;
  celune_user_id: string | null;
  installation_type: 'webhook' | 'bot';
  bot_display_name: string | null;
  bot_icon_url: string | null;
  slack_enterprise_id: string | null;
  is_enterprise_install: boolean;
  installer_slack_user_id: string | null;
}

// ---------------------------------------------------------------------------
// Slack conversation context (thread-level)
// ---------------------------------------------------------------------------

export interface SlackConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  agent?: string;
  ts: string;
}

export interface SlackConversation {
  id: string;
  workspace_id: string;
  slack_team_id: string;
  thread_ts: string;
  channel_id: string;
  user_slack_id: string;
  messages: SlackConversationMessage[];
  agent_context: Record<string, unknown>;
  active_agent: string | null;
  message_count: number;
  last_activity: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Dispatch result
// ---------------------------------------------------------------------------

export interface DispatchResult {
  channel: NotificationChannel;
  success: boolean;
  error?: string;
}
