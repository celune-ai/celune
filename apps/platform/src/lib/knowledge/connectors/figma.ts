import { getNangoToken } from '../nango-client';
import { ingestContent, type IngestResult, type IngestDocument } from '../ingest';
import type { ContentFormat } from '../normalize';

const FIGMA_API = 'https://api.figma.com/v1';

interface SyncParams {
  sourceId: string;
  workspaceId: string;
  connectionId: string;
  teamId: string;
}

// ---------------------------------------------------------------------------
// Rate-limit helper
// ---------------------------------------------------------------------------

async function figmaFetch(url: string, token: string, retries = 3): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, {
      headers: { 'X-Figma-Token': token },
    });
    if (res.status === 429) {
      const delay = 1000 * Math.pow(2, attempt);
      console.log(`[figma] Rate limited, waiting ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    return res;
  }
  throw new Error('[figma] Rate limit retries exhausted');
}

// ---------------------------------------------------------------------------
// Figma API helpers
// ---------------------------------------------------------------------------

interface FigmaProject {
  id: string;
  name: string;
}

interface FigmaFile {
  key: string;
  name: string;
  last_modified: string;
}

interface FigmaDocument {
  name: string;
  children?: FigmaDocument[];
  type: string;
}

interface FigmaComment {
  id: string;
  message: string;
  user: { handle: string };
  created_at: string;
}

async function listProjects(token: string, teamId: string): Promise<FigmaProject[]> {
  const res = await figmaFetch(`${FIGMA_API}/teams/${teamId}/projects`, token);
  if (!res.ok) return [];
  const data = (await res.json()) as { projects: FigmaProject[] };
  return data.projects;
}

async function listFiles(token: string, projectId: string): Promise<FigmaFile[]> {
  const res = await figmaFetch(`${FIGMA_API}/projects/${projectId}/files`, token);
  if (!res.ok) return [];
  const data = (await res.json()) as { files: FigmaFile[] };
  return data.files;
}

async function getFileStructure(token: string, fileKey: string): Promise<FigmaDocument | null> {
  const res = await figmaFetch(`${FIGMA_API}/files/${fileKey}?depth=3`, token);
  if (!res.ok) return null;
  const data = (await res.json()) as { document: FigmaDocument };
  return data.document;
}

async function getComments(token: string, fileKey: string): Promise<FigmaComment[]> {
  const res = await figmaFetch(`${FIGMA_API}/files/${fileKey}/comments`, token);
  if (!res.ok) return [];
  const data = (await res.json()) as { comments: FigmaComment[] };
  return data.comments;
}

function extractNames(node: FigmaDocument, prefix = ''): string[] {
  const lines: string[] = [];
  const path = prefix ? `${prefix} > ${node.name}` : node.name;
  lines.push(`- [${node.type}] ${path}`);
  if (node.children) {
    for (const child of node.children) {
      lines.push(...extractNames(child, path));
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export async function syncFigma(params: SyncParams): Promise<IngestResult> {
  const { sourceId, workspaceId, connectionId, teamId } = params;
  const token = await getNangoToken(connectionId, 'figma');

  console.log('[figma] Fetching team projects...');
  const projects = await listProjects(token, teamId);
  console.log(`[figma] Found ${projects.length} projects`);

  const documents: IngestDocument[] = [];

  for (const project of projects) {
    const files = await listFiles(token, project.id);

    for (const file of files) {
      try {
        const structure = await getFileStructure(token, file.key);
        const comments = await getComments(token, file.key);

        const structureLines = structure ? extractNames(structure) : [];
        const commentLines = comments.map(
          (c) => `**${c.user.handle}** (${c.created_at}): ${c.message}`,
        );

        const content = [
          `# ${file.name}`,
          `Project: ${project.name}`,
          `Last modified: ${file.last_modified}`,
          '',
          '## Structure',
          ...structureLines,
          '',
          comments.length > 0 ? '## Comments' : '',
          ...commentLines,
        ]
          .filter(Boolean)
          .join('\n');

        documents.push({
          externalId: file.key,
          title: `${project.name} — ${file.name}`,
          content,
          format: 'markdown' as ContentFormat,
          metadata: {
            projectId: project.id,
            projectName: project.name,
            url: `https://www.figma.com/file/${file.key}`,
          },
        });
      } catch (err) {
        console.error(`[figma] Failed to fetch file ${file.key}:`, err);
      }
    }
  }

  console.log(`[figma] Ingesting ${documents.length} documents...`);
  return ingestContent({ sourceId, workspaceId, documents });
}
