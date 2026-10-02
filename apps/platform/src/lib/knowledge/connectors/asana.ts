import { getNangoToken } from '../nango-client';
import { ingestContent, type IngestResult, type IngestDocument } from '../ingest';
import type { ContentFormat } from '../normalize';

const ASANA_API = 'https://app.asana.com/api/1.0';

interface SyncParams {
  sourceId: string;
  workspaceId: string;
  connectionId: string;
}

// ---------------------------------------------------------------------------
// Rate-limit helper
// ---------------------------------------------------------------------------

async function asanaFetch(url: string, token: string, retries = 3): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') || '1');
      const delay = retryAfter * 1000 * Math.pow(2, attempt);
      console.log(`[asana] Rate limited, waiting ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    return res;
  }
  throw new Error('[asana] Rate limit retries exhausted');
}

// ---------------------------------------------------------------------------
// Asana API helpers
// ---------------------------------------------------------------------------

interface AsanaProject {
  gid: string;
  name: string;
}

interface AsanaTask {
  gid: string;
  name: string;
  notes: string;
  completed: boolean;
  permalink_url: string;
}

interface AsanaStory {
  gid: string;
  text: string;
  type: string;
  created_by: { name: string };
  created_at: string;
}

async function listProjects(token: string): Promise<AsanaProject[]> {
  const projects: AsanaProject[] = [];
  let offset: string | undefined;

  do {
    const url = `${ASANA_API}/projects?limit=100&opt_fields=name${
      offset ? `&offset=${offset}` : ''
    }`;
    const res = await asanaFetch(url, token);
    if (!res.ok) break;

    const data = (await res.json()) as {
      data: AsanaProject[];
      next_page?: { offset: string } | null;
    };
    projects.push(...data.data);
    offset = data.next_page?.offset;
  } while (offset);

  return projects;
}

async function listTasks(token: string, projectId: string): Promise<AsanaTask[]> {
  const tasks: AsanaTask[] = [];
  let offset: string | undefined;

  do {
    const url = `${ASANA_API}/tasks?project=${projectId}&limit=100&opt_fields=name,notes,completed,permalink_url${
      offset ? `&offset=${offset}` : ''
    }`;
    const res = await asanaFetch(url, token);
    if (!res.ok) break;

    const data = (await res.json()) as {
      data: AsanaTask[];
      next_page?: { offset: string } | null;
    };
    tasks.push(...data.data);
    offset = data.next_page?.offset;
  } while (offset);

  return tasks;
}

async function getTaskStories(token: string, taskId: string): Promise<AsanaStory[]> {
  const res = await asanaFetch(
    `${ASANA_API}/tasks/${taskId}/stories?opt_fields=text,type,created_by.name,created_at`,
    token,
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { data: AsanaStory[] };
  return data.data.filter((s) => s.type === 'comment');
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export async function syncAsana(params: SyncParams): Promise<IngestResult> {
  const { sourceId, workspaceId, connectionId } = params;
  const token = await getNangoToken(connectionId, 'asana');

  console.log('[asana] Fetching projects...');
  const projects = await listProjects(token);
  console.log(`[asana] Found ${projects.length} projects`);

  const documents: IngestDocument[] = [];

  for (const project of projects) {
    const tasks = await listTasks(token, project.gid);

    for (const task of tasks) {
      const comments = await getTaskStories(token, task.gid);
      const commentText = comments
        .map((c) => `**${c.created_by.name}** (${c.created_at}):\n${c.text}`)
        .join('\n\n---\n\n');

      const content = [
        `# ${task.name}`,
        `Project: ${project.name} | Completed: ${task.completed}`,
        '',
        task.notes || '',
        comments.length > 0 ? `\n## Comments\n\n${commentText}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      documents.push({
        externalId: task.gid,
        title: `${project.name} — ${task.name}`,
        content,
        format: 'markdown' as ContentFormat,
        metadata: {
          projectId: project.gid,
          projectName: project.name,
          completed: task.completed,
          url: task.permalink_url,
        },
      });
    }
  }

  console.log(`[asana] Ingesting ${documents.length} documents...`);
  return ingestContent({ sourceId, workspaceId, documents });
}
