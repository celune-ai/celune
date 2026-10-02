import { readFileSync } from 'node:fs';
import type { HeadwaysRunProfile } from './harness.ts';

/**
 * The agent map and run profiles for one Celune workspace. v1 reads it from
 * adapter config; a Headways org setting replaces the file later.
 */
export interface HeadwaysAgentMap {
  /** Celune agent id to harness agent id. */
  agents: Record<string, string>;
  /** Harness agent id to Headways run profile. */
  profiles: Record<string, HeadwaysRunProfile>;
}

/** Reads CELUNE_HEADWAYS_AGENT_MAP (inline JSON) or CELUNE_HEADWAYS_AGENT_MAP_FILE. */
export function agentMapFromEnv(env: Record<string, string | undefined>): HeadwaysAgentMap {
  const inline = env.CELUNE_HEADWAYS_AGENT_MAP?.trim();
  const file = env.CELUNE_HEADWAYS_AGENT_MAP_FILE?.trim();
  const raw = inline || (file ? readFileSync(file, 'utf8') : '');
  if (!raw) {
    throw new Error('Set CELUNE_HEADWAYS_AGENT_MAP or CELUNE_HEADWAYS_AGENT_MAP_FILE');
  }
  return parseAgentMap(JSON.parse(raw));
}

export function parseAgentMap(value: unknown): HeadwaysAgentMap {
  const map = value as Partial<HeadwaysAgentMap> | null;
  if (!map || typeof map.agents !== 'object' || typeof map.profiles !== 'object') {
    throw new Error('Agent map needs "agents" and "profiles" objects');
  }
  const agents = map.agents as Record<string, unknown>;
  const profiles = map.profiles as Record<string, Partial<HeadwaysRunProfile>>;
  for (const [agent, harnessAgent] of Object.entries(agents)) {
    if (typeof harnessAgent !== 'string' || !harnessAgent) {
      throw new Error(`Agent ${agent} maps to an empty harness agent id`);
    }
    const profile = profiles[harnessAgent];
    if (!profile || typeof profile.model !== 'string' || !profile.model) {
      throw new Error(`Harness agent ${harnessAgent} needs a profile with a model`);
    }
  }
  return map as HeadwaysAgentMap;
}
