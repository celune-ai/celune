/**
 * POST /api/discord/interactions
 *
 * Discord Interactions Endpoint — receives all slash commands, button clicks,
 * and autocomplete requests from Discord.
 *
 * Flow:
 * 1. Verify Ed25519 signature
 * 2. Respond to PING (type 1) — required for Discord endpoint verification
 * 3. Handle APPLICATION_COMMAND (type 2) — slash commands
 * 4. Handle MESSAGE_COMPONENT (type 3) — button clicks
 *
 * Slash commands use deferred responses (type 5) so we can query Supabase
 * and respond within 15 minutes instead of the 3-second limit.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { verifyDiscordSignature } from '@/lib/discord-verify';
import { createServiceClient } from '@repo/db/service';
import {
  createFollowupMessage,
  taskEmbed,
  projectEmbed,
  memoryEmbed,
  actionRow,
  linkButton,
  primaryButton,
  COLORS,
  type DiscordEmbed,
} from '@/lib/discord-api';
import { APP_URL, DOMAIN_APP } from '@/lib/branding';

export const dynamic = 'force-dynamic';

// Discord Interaction Types
const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;
const AUTOCOMPLETE = 4;

// Discord Response Types
const PONG = 1;
const CHANNEL_MESSAGE = 4;
const DEFERRED_CHANNEL_MESSAGE = 5;
const AUTOCOMPLETE_RESULT = 8;

// ── Slash Command Handlers ──────────────────────────────────────────────────

async function handleTaskCommand(
  subcommand: string,
  options: Record<string, unknown>,
  interactionToken: string,
  discordUserId: string,
) {
  const supabase = createServiceClient();

  // Resolve Discord user → Celune workspace
  const { data: link } = await supabase
    .from('discord_connections')
    .select('workspace_id, user_id')
    .eq('discord_user_id', discordUserId)
    .eq('is_active', true)
    .maybeSingle();

  if (!link) {
    await createFollowupMessage(
      interactionToken,
      `❌ Not connected. Link your account at ${DOMAIN_APP}/settings`,
      { ephemeral: true },
    );
    return;
  }

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('slug')
    .eq('id', link.workspace_id)
    .single();

  switch (subcommand) {
    case 'list': {
      const status = (options.status as string) ?? 'in_progress';
      const { data: tasks } = await supabase
        .from('tasks')
        .select('id, title, status, priority, assignee')
        .eq('workspace_id', link.workspace_id)
        .eq('status', status)
        .order('created_at', { ascending: false })
        .limit(5);

      if (!tasks?.length) {
        await createFollowupMessage(interactionToken, `No ${status} tasks found.`);
        return;
      }

      const embeds = tasks.map((t) => taskEmbed({ ...t, workspaceSlug: workspace?.slug }));

      await createFollowupMessage(interactionToken, `**${status} tasks** (${tasks.length}):`, {
        embeds,
        components: [actionRow(linkButton('View All', `${APP_URL}/${workspace?.slug}/tasks`))],
      });
      break;
    }

    case 'create': {
      const title = options.title as string;
      const priority = (options.priority as string) ?? 'normal';

      const { data: task, error } = await supabase
        .from('tasks')
        .insert({
          title,
          priority,
          status: 'inbox',
          workspace_id: link.workspace_id,
          user_id: link.user_id,
        })
        .select('id, title, status, priority')
        .single();

      if (error) {
        await createFollowupMessage(interactionToken, '❌ Failed to create task.', {
          ephemeral: true,
        });
        return;
      }

      await createFollowupMessage(interactionToken, '✅ Task created!', {
        embeds: [taskEmbed({ ...task, workspaceSlug: workspace?.slug })],
        components: [
          actionRow(
            primaryButton('Start', `task_start_${task.id}`, { emoji: '▶️' }),
            primaryButton('Done', `task_done_${task.id}`, { emoji: '✅' }),
          ),
        ],
      });
      break;
    }

    case 'start': {
      const taskId = options.id as string;
      const { error } = await supabase
        .from('tasks')
        .update({ status: 'in_progress', updated_at: new Date().toISOString() })
        .eq('id', taskId)
        .eq('workspace_id', link.workspace_id);

      if (error) {
        await createFollowupMessage(interactionToken, '❌ Task not found.', { ephemeral: true });
        return;
      }

      await createFollowupMessage(interactionToken, `▶️ Task started!`);
      break;
    }

    case 'done': {
      const taskId = options.id as string;
      const { error } = await supabase
        .from('tasks')
        .update({ status: 'done', updated_at: new Date().toISOString() })
        .eq('id', taskId)
        .eq('workspace_id', link.workspace_id);

      if (error) {
        await createFollowupMessage(interactionToken, '❌ Task not found.', { ephemeral: true });
        return;
      }

      await createFollowupMessage(interactionToken, '✅ Task completed!');
      break;
    }

    default:
      await createFollowupMessage(interactionToken, `Unknown subcommand: ${subcommand}`, {
        ephemeral: true,
      });
  }
}

async function handleMemoryCommand(
  subcommand: string,
  options: Record<string, unknown>,
  interactionToken: string,
  discordUserId: string,
) {
  const supabase = createServiceClient();

  const { data: link } = await supabase
    .from('discord_connections')
    .select('workspace_id, user_id')
    .eq('discord_user_id', discordUserId)
    .eq('is_active', true)
    .maybeSingle();

  if (!link) {
    await createFollowupMessage(interactionToken, '❌ Not connected.', { ephemeral: true });
    return;
  }

  if (subcommand === 'search') {
    const query = options.query as string;

    // Full-text search on agent_memory
    const { data: memories } = await supabase
      .from('agent_memory')
      .select('id, content, category')
      .eq('workspace_id', link.workspace_id)
      .textSearch('content', query, { type: 'websearch' })
      .limit(3);

    if (!memories?.length) {
      await createFollowupMessage(interactionToken, `No memories found for "${query}".`);
      return;
    }

    const embeds = memories.map((m) => memoryEmbed(m));
    await createFollowupMessage(interactionToken, `🧠 Found ${memories.length} memories:`, {
      embeds,
    });
  }
}

async function handleProjectCommand(
  subcommand: string,
  options: Record<string, unknown>,
  interactionToken: string,
  discordUserId: string,
) {
  const supabase = createServiceClient();

  const { data: link } = await supabase
    .from('discord_connections')
    .select('workspace_id, user_id')
    .eq('discord_user_id', discordUserId)
    .eq('is_active', true)
    .maybeSingle();

  if (!link) {
    await createFollowupMessage(interactionToken, '❌ Not connected.', { ephemeral: true });
    return;
  }

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('slug')
    .eq('id', link.workspace_id)
    .single();

  if (subcommand === 'list' || subcommand === 'status') {
    const { data: projects } = await supabase
      .from('projects')
      .select('id, name, status, description')
      .eq('workspace_id', link.workspace_id)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(5);

    if (!projects?.length) {
      await createFollowupMessage(interactionToken, 'No active projects.');
      return;
    }

    // Get task counts per project (batched — avoids N+1)
    const projectIds = projects.map((p) => p.id);
    const [{ data: totalCounts }, { data: doneCounts }] = await Promise.all([
      supabase
        .from('tasks')
        .select('project_id', { count: 'exact', head: false })
        .in('project_id', projectIds)
        .then(async () => {
          // Supabase doesn't support GROUP BY via PostgREST — use parallel counts
          const results = await Promise.all(
            projectIds.map((id) =>
              supabase
                .from('tasks')
                .select('id', { count: 'exact', head: true })
                .eq('project_id', id)
                .then(({ count }) => ({ project_id: id, count: count ?? 0 })),
            ),
          );
          return { data: results };
        }),
      Promise.all(
        projectIds.map((id) =>
          supabase
            .from('tasks')
            .select('id', { count: 'exact', head: true })
            .eq('project_id', id)
            .eq('status', 'done')
            .then(({ count }) => ({ project_id: id, count: count ?? 0 })),
        ),
      ).then((results) => ({ data: results })),
    ]);

    const totalMap = new Map(totalCounts?.map((r) => [r.project_id, r.count]));
    const doneMap = new Map(doneCounts?.map((r) => [r.project_id, r.count]));

    const embeds: DiscordEmbed[] = projects.map((p) =>
      projectEmbed({
        ...p,
        totalTasks: totalMap.get(p.id) ?? 0,
        doneTasks: doneMap.get(p.id) ?? 0,
        workspaceSlug: workspace?.slug,
      }),
    );

    await createFollowupMessage(interactionToken, `📊 **Active projects** (${projects.length}):`, {
      embeds,
      components: [actionRow(linkButton('View All', `${APP_URL}/${workspace?.slug}/projects`))],
    });
  }
}

// ── Summary Command Handler (v2) ───────────────────────────────────────────

async function handleSummaryCommand(
  options: Record<string, unknown>,
  interactionToken: string,
  discordUserId: string,
  interactionBody: Record<string, unknown>,
) {
  const supabase = createServiceClient();

  // Resolve workspace
  const { data: link } = await supabase
    .from('discord_connections')
    .select('workspace_id, user_id')
    .eq('discord_user_id', discordUserId)
    .eq('is_active', true)
    .maybeSingle();

  if (!link) {
    await createFollowupMessage(interactionToken, '❌ Not connected.', { ephemeral: true });
    return;
  }

  const timeframe = (options.timeframe as string) ?? '4h';
  const hours = parseInt(timeframe.replace('h', ''), 10) || 4;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  // Get the channel ID from the interaction
  const channelId = interactionBody.channel_id as string;
  if (!channelId) {
    await createFollowupMessage(interactionToken, '❌ Could not determine channel.', {
      ephemeral: true,
    });
    return;
  }

  // Fetch stored Discord memories from this channel in the timeframe
  const { data: memories } = await supabase
    .from('agent_memory')
    .select('content, metadata, created_at')
    .eq('workspace_id', link.workspace_id)
    .eq('category', 'discord_conversation')
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(50);

  // Filter to just this channel's messages
  const channelMemories = (memories ?? []).filter((m) => {
    const meta = m.metadata as Record<string, unknown> | null;
    return meta?.discord_channel_id === channelId;
  });

  if (!channelMemories.length) {
    await createFollowupMessage(
      interactionToken,
      `No conversation data found in the last ${hours} hour(s) for this channel.`,
    );
    return;
  }

  // Collect message content for summarization
  const messageTexts = channelMemories.map((m) => m.content).join('\n---\n');

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            'Summarize the following Discord conversation. Include:',
            '1. Key topics discussed',
            '2. Decisions made',
            '3. Action items or next steps',
            '',
            'Keep the summary concise but comprehensive. Use bullet points.',
            '',
            `Conversation from the last ${hours} hour(s):`,
            messageTexts,
          ].join('\n'),
        },
      ],
    });

    const summaryText =
      response.content[0]?.type === 'text'
        ? response.content[0].text
        : 'Unable to generate summary.';

    const embed: DiscordEmbed = {
      title: `📝 Conversation Summary (last ${hours}h)`,
      description: summaryText.slice(0, 4000),
      color: COLORS.info,
      fields: [
        {
          name: 'Messages analyzed',
          value: `${channelMemories.length}`,
          inline: true,
        },
        {
          name: 'Period',
          value: `Last ${hours} hour(s)`,
          inline: true,
        },
      ],
      footer: { text: 'Powered by Celune AI' },
      timestamp: new Date().toISOString(),
    };

    await createFollowupMessage(interactionToken, '', { embeds: [embed] });
  } catch (err) {
    console.error('[discord-interactions] Summary generation failed:', err);
    await createFollowupMessage(interactionToken, '❌ Failed to generate summary.', {
      ephemeral: true,
    });
  }
}

// ── Autocomplete Handler ────────────────────────────────────────────────────

async function handleAutocomplete(
  data: Record<string, unknown>,
  discordUserId: string,
): Promise<{ name: string; value: string }[]> {
  const supabase = createServiceClient();

  // Resolve user
  const { data: link } = await supabase
    .from('discord_connections')
    .select('workspace_id')
    .eq('discord_user_id', discordUserId)
    .eq('is_active', true)
    .maybeSingle();

  if (!link) return [];

  // Walk the options tree to find the focused option
  const cmdOptions = (data.options as Array<Record<string, unknown>>) ?? [];
  let focusedName = '';
  let focusedValue = '';
  let context = ''; // 'task' or 'project'

  function walkOptions(opts: Array<Record<string, unknown>>, parent?: string) {
    for (const opt of opts) {
      if (opt.name === 'task' || opt.name === 'project') context = opt.name as string;
      if (opt.focused) {
        focusedName = opt.name as string;
        focusedValue = (opt.value as string) ?? '';
      }
      if (opt.options) {
        walkOptions(opt.options as Array<Record<string, unknown>>, opt.name as string);
      }
    }
  }
  walkOptions(cmdOptions);

  // Task ID autocomplete — search tasks by partial title
  if (context === 'task' && focusedName === 'id') {
    const query = supabase
      .from('tasks')
      .select('id, title, status')
      .eq('workspace_id', link.workspace_id)
      .in('status', ['inbox', 'assigned', 'in_progress', 'planning', 'backlog'])
      .order('updated_at', { ascending: false })
      .limit(25);

    if (focusedValue) {
      query.ilike('title', `%${focusedValue}%`);
    }

    const { data: tasks } = await query;
    return (tasks ?? []).map((t) => ({
      name: `${t.title.slice(0, 90)} [${t.status}]`,
      value: t.id,
    }));
  }

  // Project name autocomplete
  if (context === 'project' && focusedName === 'name') {
    const query = supabase
      .from('projects')
      .select('id, name')
      .eq('workspace_id', link.workspace_id)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(25);

    if (focusedValue) {
      query.ilike('name', `%${focusedValue}%`);
    }

    const { data: projects } = await query;
    return (projects ?? []).map((p) => ({
      name: p.name.slice(0, 100),
      value: p.id,
    }));
  }

  return [];
}

// ── Button Click Handlers ───────────────────────────────────────────────────

async function handleButtonClick(
  customId: string,
  interactionToken: string,
  discordUserId: string,
) {
  const supabase = createServiceClient();

  const { data: link } = await supabase
    .from('discord_connections')
    .select('workspace_id, user_id')
    .eq('discord_user_id', discordUserId)
    .eq('is_active', true)
    .maybeSingle();

  if (!link) {
    await createFollowupMessage(interactionToken, '❌ Not connected.', { ephemeral: true });
    return;
  }

  if (customId.startsWith('task_start_')) {
    const taskId = customId.replace('task_start_', '');
    await supabase
      .from('tasks')
      .update({ status: 'in_progress', updated_at: new Date().toISOString() })
      .eq('id', taskId)
      .eq('workspace_id', link.workspace_id);
    await createFollowupMessage(interactionToken, '▶️ Task started!');
  } else if (customId.startsWith('task_done_')) {
    const taskId = customId.replace('task_done_', '');
    await supabase
      .from('tasks')
      .update({ status: 'done', updated_at: new Date().toISOString() })
      .eq('id', taskId)
      .eq('workspace_id', link.workspace_id);
    await createFollowupMessage(interactionToken, '✅ Task completed!');
  }
}

// ── Route Handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');

  // Verify signature
  if (!verifyDiscordSignature(signature, timestamp, rawBody)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const type = body.type as number;

  // PING — required for Discord endpoint verification
  if (type === PING) {
    return NextResponse.json({ type: PONG });
  }

  // APPLICATION_COMMAND — slash commands
  if (type === APPLICATION_COMMAND) {
    const data = body.data as Record<string, unknown>;
    const commandName = data.name as string;
    const interactionToken = body.token as string;
    const discordUser =
      ((body.member as Record<string, unknown>)?.user as Record<string, unknown>) ??
      (body.user as Record<string, unknown>);
    const discordUserId = discordUser?.id as string;

    // Get subcommand and options
    const cmdOptions = (data.options as Array<Record<string, unknown>>) ?? [];
    const subcommand = cmdOptions[0]?.name as string;
    const subOptions: Record<string, unknown> = {};
    for (const opt of (cmdOptions[0]?.options as Array<Record<string, unknown>>) ?? []) {
      subOptions[opt.name as string] = opt.value;
    }

    // Defer the response (we'll send a followup after processing)
    const deferResponse = NextResponse.json({ type: DEFERRED_CHANNEL_MESSAGE });

    // Process in background
    (async () => {
      try {
        switch (commandName) {
          case 'celune':
            // Top-level command group
            switch (subcommand) {
              case 'task':
                const taskSub = (cmdOptions[0]?.options as Array<Record<string, unknown>>)?.[0];
                const taskSubName = taskSub?.name as string;
                const taskOpts: Record<string, unknown> = {};
                for (const o of (taskSub?.options as Array<Record<string, unknown>>) ?? []) {
                  taskOpts[o.name as string] = o.value;
                }
                await handleTaskCommand(taskSubName, taskOpts, interactionToken, discordUserId);
                break;
              case 'memory':
                await handleMemoryCommand('search', subOptions, interactionToken, discordUserId);
                break;
              case 'project':
                await handleProjectCommand(subcommand, subOptions, interactionToken, discordUserId);
                break;
              case 'summary':
                await handleSummaryCommand(subOptions, interactionToken, discordUserId, body);
                break;
              default:
                await createFollowupMessage(interactionToken, `Unknown command: ${subcommand}`, {
                  ephemeral: true,
                });
            }
            break;
          default:
            await createFollowupMessage(interactionToken, `Unknown command: ${commandName}`, {
              ephemeral: true,
            });
        }
      } catch (err) {
        console.error('[discord-interactions] Command handler error:', err);
        await createFollowupMessage(interactionToken, '❌ An error occurred.', { ephemeral: true });
      }
    })();

    return deferResponse;
  }

  // AUTOCOMPLETE — slash command option autocomplete
  if (type === AUTOCOMPLETE) {
    const data = body.data as Record<string, unknown>;
    const discordUser =
      ((body.member as Record<string, unknown>)?.user as Record<string, unknown>) ??
      (body.user as Record<string, unknown>);
    const discordUserId = discordUser?.id as string;

    try {
      const choices = await handleAutocomplete(data, discordUserId);
      return NextResponse.json({ type: AUTOCOMPLETE_RESULT, data: { choices } });
    } catch (err) {
      console.error('[discord-interactions] Autocomplete error:', err);
      return NextResponse.json({ type: AUTOCOMPLETE_RESULT, data: { choices: [] } });
    }
  }

  // MESSAGE_COMPONENT — button clicks
  if (type === MESSAGE_COMPONENT) {
    const data = body.data as Record<string, unknown>;
    const customId = data.custom_id as string;
    const interactionToken = body.token as string;
    const discordUser =
      ((body.member as Record<string, unknown>)?.user as Record<string, unknown>) ??
      (body.user as Record<string, unknown>);
    const discordUserId = discordUser?.id as string;

    const deferResponse = NextResponse.json({ type: DEFERRED_CHANNEL_MESSAGE });

    (async () => {
      try {
        await handleButtonClick(customId, interactionToken, discordUserId);
      } catch (err) {
        console.error('[discord-interactions] Button handler error:', err);
        await createFollowupMessage(interactionToken, '❌ An error occurred.', { ephemeral: true });
      }
    })();

    return deferResponse;
  }

  return NextResponse.json({ error: 'Unknown interaction type' }, { status: 400 });
}
