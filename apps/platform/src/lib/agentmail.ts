import { AgentMailClient } from 'agentmail';
import { hostConfig } from '@/lib/host-config';

const AGENTMAIL_API_KEY = process.env.AGENTMAIL_API_KEY;

let _client: AgentMailClient | null = null;

/** Singleton AgentMail client. Throws if AGENTMAIL_API_KEY is not set. */
export function getAgentMailClient(): AgentMailClient {
  if (!_client) {
    if (!AGENTMAIL_API_KEY) {
      throw new Error('AGENTMAIL_API_KEY is not configured');
    }
    _client = new AgentMailClient({ apiKey: AGENTMAIL_API_KEY });
  }
  return _client;
}

/** Domain for agent inboxes (AGENT_MAIL_DOMAIN, defaults to the marketing domain) */
export const AGENT_MAIL_DOMAIN = hostConfig.agentMailDomain;

/** Map agent IDs to their email display names */
export function agentDisplayName(agentId: string): string {
  const names: Record<string, string> = {
    rick: 'RICK — Engineering Lead',
    sage: 'SAGE — Product Strategy',
    noir: 'NOIR — Design Lead',
    scan: 'SCAN — Code Review',
    delv: 'DELV — Research',
    trek: 'TREK — Career Strategy',
    echo: 'ECHO — Brand',
    bond: 'BOND — Relationships',
    vita: 'VITA — Growth',
    ward: 'WARD — Guardian',
  };
  return names[agentId] ?? agentId;
}

/** Build the email address for an agent: `<agentId>@<agent mail domain>` */
export function agentEmailAddress(agentId: string): string {
  return `${agentId}@${AGENT_MAIL_DOMAIN}`;
}

/** Extract email address from AgentMail displayName format: "Name <user@domain>" */
export function extractInboxEmail(displayName?: string): string | null {
  if (!displayName) return null;
  const match = displayName.match(/<([^>]+)>/);
  return match ? match[1] : null;
}
