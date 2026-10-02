// Activity Feed & Agent Messages types
// Used by /api/agents/activity and /api/agents/messages

export const FEED_ACTION_TYPES = [
  'claimed',
  'completed',
  'delegated',
  'reviewed',
  'milestone',
  'error',
  'message',
] as const;
export type FeedActionType = (typeof FEED_ACTION_TYPES)[number];

export const MESSAGE_TYPES = ['delegation', 'review', 'discussion'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

/** A single entry in the activity feed timeline. */
export interface ActivityFeedEntry {
  id: string;
  agent_id: string;
  agent_name: string;
  action_type: FeedActionType;
  title: string;
  summary: string | null;
  reasoning: string | null;
  task_id: string | null;
  project_id: string | null;
  is_milestone: boolean;
  created_at: string;
}

/** A single message in an inter-agent thread. */
export interface AgentMessage {
  id: string;
  from_agent: string;
  from_agent_name: string;
  to_agent: string | null;
  to_agent_name: string | null;
  content: string;
  message_type: MessageType;
  task_id: string | null;
  created_at: string;
}

/** A conversation thread between agents. */
export interface MessageThread {
  id: string;
  participants: string[];
  messages: AgentMessage[];
  task_id: string | null;
  project_id: string | null;
  title: string;
  created_at: string;
}

/** Paginated response for the activity feed. */
export interface ActivityFeedResponse {
  entries: ActivityFeedEntry[];
  nextCursor: string | null;
  total: number;
}

/** Paginated response for message threads. */
export interface MessageThreadResponse {
  threads: MessageThread[];
  nextCursor: string | null;
  total: number;
}
