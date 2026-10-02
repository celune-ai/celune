/** Who is calling a service and through which surface. Feeds activity rows. */
export interface ActorContext {
  /** Surface the call came from: web, mcp, task-cli, or a host name. */
  source: string;
  /** Authenticated user id; written to activity_log.actor_user_id. */
  userId?: string | null;
  /** Owner user id for hosts that stamp activity_log.user_id (the CLI does). */
  ownerUserId?: string | null;
  /** Agent performing the action, when the caller is an agent. */
  agentId?: string | null;
}
