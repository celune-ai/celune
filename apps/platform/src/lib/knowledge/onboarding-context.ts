/**
 * Knowledge Base context for onboarding.
 *
 * Queries connected knowledge sources and builds a structured summary
 * that gets injected into the onboarding chat system prompt and
 * project generation prompt. This lets agents reference what they
 * found in the user's docs/code/tickets before the conversation.
 *
 * From user test (Michael Ke Zhang): "The ideal flow is: agents study
 * your codebase, study your documentation and tickets, then have an
 * informed conversation that's tactical about what to build."
 */

import { createServiceClient } from '@repo/db/service';

/**
 * Build a knowledge context block for the onboarding conversation.
 * Returns an empty string if no KB sources are connected.
 *
 * The context includes:
 * - Which sources are connected and their sync status
 * - A summary of what was found (document titles, project names, etc.)
 * - Key themes/topics extracted from the content
 * - Specific items the agent should reference in conversation
 */
export async function getKnowledgeContextForOnboarding(workspaceId: string): Promise<string> {
  const supabase = createServiceClient();

  // Check if any knowledge sources exist
  const { data: sources } = await supabase
    .from('knowledge_sources')
    .select('id, provider, display_name, status, items_count')
    .eq('workspace_id', workspaceId)
    .in('status', ['active', 'syncing']);

  if (!sources?.length) return '';

  // Fetch a representative sample of KB items (titles + short content)
  const { data: items } = await supabase
    .from('knowledge_items')
    .select('title, content, metadata, source_id')
    .eq('workspace_id', workspaceId)
    .order('importance_score', { ascending: false })
    .limit(50);

  if (!items?.length) return '';

  // Build source map for attribution
  const sourceMap = new Map(sources.map((s) => [s.id, s]));

  // Group items by source
  const bySource = new Map<string, typeof items>();
  for (const item of items) {
    const key = item.source_id;
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key)!.push(item);
  }

  // Build the context block
  const sections: string[] = [];
  sections.push('\n\n## Knowledge Base Context');
  sections.push(
    "The user has connected knowledge sources. You've studied their content. Reference specific findings naturally in conversation — don't list them robotically.",
  );
  sections.push(
    'This is what makes you different from a generic AI — you already know their world. Use this knowledge to ask targeted, specific questions instead of generic ones.',
  );
  sections.push('');

  // Connected sources summary
  const sourceList = sources
    .map((s) => `- **${s.display_name}** (${s.provider}): ${s.items_count} items indexed`)
    .join('\n');
  sections.push(`### Connected Sources\n${sourceList}\n`);

  // Content summary per source
  for (const [sourceId, sourceItems] of bySource) {
    const source = sourceMap.get(sourceId);
    if (!source) continue;

    const titles = sourceItems
      .map((i) => i.title)
      .filter(Boolean)
      .slice(0, 15);

    const contentPreview = sourceItems
      .slice(0, 5)
      .map((i) => {
        const preview = i.content.slice(0, 200).replace(/\n/g, ' ');
        return `- ${i.title ?? 'Untitled'}: ${preview}...`;
      })
      .join('\n');

    sections.push(`### From ${source.display_name} (${source.provider})`);
    if (titles.length > 0) {
      sections.push(`**Documents found:** ${titles.join(', ')}`);
    }
    sections.push(`**Sample content:**\n${contentPreview}`);
    sections.push('');
  }

  // Instructions for the agent
  sections.push('### How to Use This Context');
  sections.push(
    '- Reference specific documents, projects, or patterns you found — e.g., "I see you have a project about course progression in Notion..."',
  );
  sections.push(
    '- Ask targeted follow-up questions based on what you found — e.g., "Your GitHub repo uses FastAPI — tell me about the architecture decisions there"',
  );
  sections.push(
    '- Identify gaps or opportunities from what you see — e.g., "I noticed you have 12 open issues but no CI pipeline — is that something you want to address?"',
  );
  sections.push(
    "- Don't dump everything you know. Weave it into natural conversation. The user should feel like you actually studied their work.",
  );

  return sections.join('\n');
}

/**
 * Build a knowledge context block for project generation.
 * More structured than the chat version — focused on identifying
 * concrete projects and tasks from the KB content.
 */
export async function getKnowledgeContextForProjectGeneration(
  workspaceId: string,
): Promise<string> {
  const supabase = createServiceClient();

  const { data: sources } = await supabase
    .from('knowledge_sources')
    .select('id, provider, display_name, items_count')
    .eq('workspace_id', workspaceId)
    .in('status', ['active', 'syncing']);

  if (!sources?.length) return '';

  // Fetch more items for project generation — we want breadth
  const { data: items } = await supabase
    .from('knowledge_items')
    .select('title, content, metadata, source_id')
    .eq('workspace_id', workspaceId)
    .order('importance_score', { ascending: false })
    .limit(100);

  if (!items?.length) return '';

  const sourceMap = new Map(sources.map((s) => [s.id, s]));

  const sections: string[] = [];
  sections.push('\n\n## Knowledge Base Analysis');
  sections.push(
    "The following content was crawled from the user's connected knowledge sources. Use this to generate highly relevant, specific projects — not generic suggestions.",
  );
  sections.push('');

  // Group by source and extract project-relevant signals
  const bySource = new Map<string, typeof items>();
  for (const item of items) {
    if (!bySource.has(item.source_id)) bySource.set(item.source_id, []);
    bySource.get(item.source_id)!.push(item);
  }

  for (const [sourceId, sourceItems] of bySource) {
    const source = sourceMap.get(sourceId);
    if (!source) continue;

    sections.push(`### ${source.display_name} (${source.provider}) — ${sourceItems.length} items`);

    // Extract titles as potential project themes
    const titles = sourceItems.map((i) => i.title).filter(Boolean);
    if (titles.length > 0) {
      sections.push(`**Topics:** ${titles.slice(0, 20).join(', ')}`);
    }

    // Include content previews for context
    const previews = sourceItems.slice(0, 8).map((i) => {
      const preview = i.content.slice(0, 300).replace(/\n/g, ' ');
      return `- **${i.title ?? 'Untitled'}:** ${preview}`;
    });
    sections.push(previews.join('\n'));
    sections.push('');
  }

  sections.push('### Project Generation Guidelines');
  sections.push('- Create projects that directly address what you see in the KB content');
  sections.push(
    '- If you see TODO items, open issues, or incomplete work — suggest projects to finish them',
  );
  sections.push(
    '- If you see architectural patterns — suggest improvements based on best practices',
  );
  sections.push('- Reference specific documents/files from the KB in project descriptions');

  return sections.join('\n');
}
