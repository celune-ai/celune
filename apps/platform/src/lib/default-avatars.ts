/**
 * 35 default avatar icons — colorful geometric shapes.
 * Used as defaults for both user and agent avatars.
 */
export const DEFAULT_AVATARS = Array.from({ length: 35 }, (_, i) => `/avatars/Shape_${i + 1}.png`);

/**
 * Pre-assigned avatar mapping for agents.
 * Each agent gets a unique default avatar — no duplicates.
 */
export const AGENT_AVATAR_MAP: Record<string, string> = {
  rick: DEFAULT_AVATARS[0],
  sage: DEFAULT_AVATARS[1],
  noir: DEFAULT_AVATARS[2],
  scan: DEFAULT_AVATARS[3],
  delv: DEFAULT_AVATARS[4],
  trek: DEFAULT_AVATARS[5],
  echo: DEFAULT_AVATARS[6],
  bond: DEFAULT_AVATARS[7],
  vita: DEFAULT_AVATARS[8],
};

/** Avatar indices reserved by agents (0-9), so user defaults start at 10. */
const AGENT_RESERVED_COUNT = Object.keys(AGENT_AVATAR_MAP).length;

/** Get a random default avatar for a new user (not one reserved for agents). */
export function getRandomUserAvatar(): string {
  const available = DEFAULT_AVATARS.slice(AGENT_RESERVED_COUNT);
  return available[Math.floor(Math.random() * available.length)];
}

/** Get the next available avatar cycling through all defaults. */
export function getNextAvatar(currentAvatar: string | null, excludeAgentAvatars = false): string {
  const pool = excludeAgentAvatars ? DEFAULT_AVATARS.slice(AGENT_RESERVED_COUNT) : DEFAULT_AVATARS;
  if (!currentAvatar) return pool[0];
  const currentIndex = pool.indexOf(currentAvatar);
  if (currentIndex === -1) return pool[0];
  return pool[(currentIndex + 1) % pool.length];
}
