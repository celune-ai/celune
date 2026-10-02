/**
 * Shared GitHub URL parsing utilities.
 *
 * Centralises owner/repo extraction from GitHub URLs so that every consumer
 * uses the same logic instead of ad-hoc regex or URL parsing.
 */

export interface GitHubRepoRef {
  owner: string;
  repo: string;
  fullName: string;
}

/**
 * Parse a GitHub URL and extract the owner, repo name, and full name.
 *
 * Handles:
 *  - https://github.com/owner/repo
 *  - https://github.com/owner/repo.git
 *  - Trailing slashes
 *  - Extra path segments (e.g. /tree/main) are ignored — only first two
 *    pathname segments matter.
 *
 * Returns `null` for non-GitHub URLs, empty strings, or malformed input.
 */
export function parseGitHubUrl(url: string): GitHubRepoRef | null {
  if (!url || typeof url !== 'string') return null;

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') {
    return null;
  }

  // pathname is e.g. "/owner/repo.git" or "/owner/repo/"
  const segments = parsed.pathname
    .replace(/\.git$/, '')
    .split('/')
    .filter(Boolean);

  if (segments.length < 2) return null;

  const owner = segments[0];
  const repo = segments[1];

  if (!owner || !repo) return null;

  return { owner, repo, fullName: `${owner}/${repo}` };
}
