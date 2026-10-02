import { getNangoToken } from '../nango-client';
import { ingestContent, type IngestResult, type IngestDocument } from '../ingest';
import type { ContentFormat } from '../normalize';

const LINEAR_API = 'https://api.linear.app/graphql';

interface SyncParams {
  sourceId: string;
  workspaceId: string;
  connectionId: string;
}

// ---------------------------------------------------------------------------
// GraphQL helper
// ---------------------------------------------------------------------------

async function linearQuery(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
  retries = 3,
): Promise<unknown> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(LINEAR_API, {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (res.status === 429) {
      const delay = 1000 * Math.pow(2, attempt);
      console.log(`[linear] Rate limited, waiting ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    if (!res.ok) throw new Error(`Linear API error: ${res.status}`);
    const data = (await res.json()) as { data: unknown; errors?: unknown[] };
    if (data.errors) throw new Error(`Linear GraphQL errors: ${JSON.stringify(data.errors)}`);
    return data.data;
  }
  throw new Error('[linear] Rate limit retries exhausted');
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const ISSUES_QUERY = `
  query($cursor: String) {
    issues(first: 100, after: $cursor, orderBy: updatedAt) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        identifier
        title
        description
        state { name }
        priority
        url
        comments {
          nodes {
            body
            user { name }
            createdAt
          }
        }
        project {
          id
          name
        }
      }
    }
  }
`;

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: { name: string };
  priority: number;
  url: string;
  comments: {
    nodes: Array<{ body: string; user: { name: string }; createdAt: string }>;
  };
  project: { id: string; name: string } | null;
}

interface IssuesResponse {
  issues: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: LinearIssue[];
  };
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export async function syncLinear(params: SyncParams): Promise<IngestResult> {
  const { sourceId, workspaceId, connectionId } = params;
  const token = await getNangoToken(connectionId, 'linear');

  console.log('[linear] Fetching issues...');
  const allIssues: LinearIssue[] = [];
  let cursor: string | null = null;

  do {
    const data = (await linearQuery(token, ISSUES_QUERY, {
      cursor,
    })) as IssuesResponse;

    allIssues.push(...data.issues.nodes);
    cursor = data.issues.pageInfo.hasNextPage ? data.issues.pageInfo.endCursor : null;
  } while (cursor);

  console.log(`[linear] Found ${allIssues.length} issues`);

  const documents: IngestDocument[] = allIssues.map((issue) => {
    const comments = issue.comments.nodes
      .map((c) => `**${c.user.name}** (${c.createdAt}):\n${c.body}`)
      .join('\n\n---\n\n');

    const content = [
      `# ${issue.identifier}: ${issue.title}`,
      `Status: ${issue.state.name} | Priority: ${issue.priority}`,
      issue.project ? `Project: ${issue.project.name}` : '',
      '',
      issue.description || '',
      comments ? `\n## Comments\n\n${comments}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      externalId: issue.id,
      title: `${issue.identifier}: ${issue.title}`,
      content,
      format: 'markdown' as ContentFormat,
      metadata: {
        identifier: issue.identifier,
        status: issue.state.name,
        url: issue.url,
        projectId: issue.project?.id,
      },
    };
  });

  console.log(`[linear] Ingesting ${documents.length} documents...`);
  return ingestContent({ sourceId, workspaceId, documents });
}
