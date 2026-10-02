import { getNangoToken } from '../nango-client';
import { ingestContent, type IngestResult, type IngestDocument } from '../ingest';
import type { ContentFormat } from '../normalize';

const GITHUB_API = 'https://api.github.com';

/** Cap total documents to prevent unbounded ingestion */
const MAX_REPOS = 50;
const MAX_ISSUES_PER_REPO = 50;
const MAX_DOCS_PER_REPO = 20;

interface SyncParams {
  sourceId: string;
  workspaceId: string;
  connectionId: string;
}

// ---------------------------------------------------------------------------
// Rate-limit helper
// ---------------------------------------------------------------------------

async function ghFetch(url: string, token: string, retries = 3): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });
    if (res.status === 429 || res.status === 403) {
      const resetHeader = res.headers.get('x-ratelimit-reset');
      const waitMs = resetHeader
        ? Math.max(0, Number(resetHeader) * 1000 - Date.now())
        : 1000 * Math.pow(2, attempt);
      const delay = Math.min(waitMs, 60_000);
      console.log(`[github] Rate limited, waiting ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    return res;
  }
  throw new Error('[github] Rate limit retries exhausted');
}

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

interface GHRepo {
  id: number;
  full_name: string;
  html_url: string;
  default_branch: string;
}

interface GHContent {
  name: string;
  path: string;
  type: string;
  download_url: string | null;
  html_url: string;
}

interface GHIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
}

interface GHComment {
  id: number;
  body: string;
  user: { login: string };
  created_at: string;
}

async function listRepos(token: string): Promise<GHRepo[]> {
  const repos: GHRepo[] = [];
  let page = 1;

  while (page <= 10) {
    const res = await ghFetch(`${GITHUB_API}/user/repos?per_page=100&page=${page}`, token);
    if (!res.ok) break;
    const data = (await res.json()) as GHRepo[];
    if (data.length === 0) break;
    repos.push(...data);
    page++;
  }

  return repos;
}

async function getReadme(token: string, repo: string): Promise<string | null> {
  const res = await ghFetch(`${GITHUB_API}/repos/${repo}/readme`, token);
  if (!res.ok) return null;
  const data = (await res.json()) as { content: string; encoding: string };
  if (data.encoding === 'base64') {
    return Buffer.from(data.content, 'base64').toString('utf-8');
  }
  return null;
}

async function getDocsFolder(token: string, repo: string): Promise<GHContent[]> {
  const res = await ghFetch(`${GITHUB_API}/repos/${repo}/contents/docs`, token);
  if (!res.ok) return [];
  const data = (await res.json()) as GHContent[];
  return data.filter((f) => f.type === 'file' && /\.(md|txt|rst)$/i.test(f.name));
}

async function getFileContent(token: string, url: string): Promise<string | null> {
  const res = await ghFetch(url, token);
  if (!res.ok) return null;
  const data = (await res.json()) as { content: string; encoding: string };
  if (data.encoding === 'base64') {
    return Buffer.from(data.content, 'base64').toString('utf-8');
  }
  return null;
}

async function getOpenIssues(token: string, repo: string): Promise<GHIssue[]> {
  const res = await ghFetch(`${GITHUB_API}/repos/${repo}/issues?state=open&per_page=100`, token);
  if (!res.ok) return [];
  return (await res.json()) as GHIssue[];
}

async function getIssueComments(
  token: string,
  repo: string,
  issueNumber: number,
): Promise<GHComment[]> {
  const res = await ghFetch(
    `${GITHUB_API}/repos/${repo}/issues/${issueNumber}/comments?per_page=50`,
    token,
  );
  if (!res.ok) return [];
  return (await res.json()) as GHComment[];
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export async function syncGitHub(params: SyncParams): Promise<IngestResult> {
  const { sourceId, workspaceId, connectionId } = params;
  const token = await getNangoToken(connectionId, 'github-getting-started');

  console.log('[github] Fetching repos...');
  const allRepos = await listRepos(token);
  const repos = allRepos.slice(0, MAX_REPOS);
  console.log(`[github] Found ${allRepos.length} repos, processing ${repos.length}`);

  const documents: IngestDocument[] = [];

  for (const repo of repos) {
    // README
    const readme = await getReadme(token, repo.full_name);
    if (readme) {
      documents.push({
        externalId: `${repo.full_name}/README`,
        title: `${repo.full_name} — README`,
        content: readme,
        format: 'markdown' as ContentFormat,
        metadata: { repo: repo.full_name, url: repo.html_url },
      });
    }

    // Docs folder
    const allDocs = await getDocsFolder(token, repo.full_name);
    const docs = allDocs.slice(0, MAX_DOCS_PER_REPO);
    for (const doc of docs) {
      if (!doc.download_url) continue;
      const content = await getFileContent(
        token,
        `${GITHUB_API}/repos/${repo.full_name}/contents/${doc.path}`,
      );
      if (content) {
        documents.push({
          externalId: `${repo.full_name}/${doc.path}`,
          title: `${repo.full_name} — ${doc.path}`,
          content,
          format: 'markdown' as ContentFormat,
          metadata: { repo: repo.full_name, url: doc.html_url },
        });
      }
    }

    // Open issues (capped to prevent unbounded fetching)
    const allIssues = await getOpenIssues(token, repo.full_name);
    const issues = allIssues.slice(0, MAX_ISSUES_PER_REPO);
    for (const issue of issues) {
      const comments = await getIssueComments(token, repo.full_name, issue.number);
      const commentText = comments
        .map((c) => `**${c.user.login}** (${c.created_at}):\n${c.body}`)
        .join('\n\n---\n\n');

      const body = [
        `# ${issue.title}`,
        `State: ${issue.state}`,
        '',
        issue.body || '',
        comments.length > 0 ? '\n## Comments\n\n' + commentText : '',
      ].join('\n');

      documents.push({
        externalId: `${repo.full_name}/issues/${issue.number}`,
        title: `${repo.full_name} #${issue.number} — ${issue.title}`,
        content: body,
        format: 'markdown' as ContentFormat,
        metadata: { repo: repo.full_name, url: issue.html_url, type: 'issue' },
      });
    }
  }

  console.log(`[github] Ingesting ${documents.length} documents...`);
  return ingestContent({ sourceId, workspaceId, documents });
}
