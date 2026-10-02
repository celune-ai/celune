/**
 * POST /api/discord/register-commands
 *
 * Registers (or updates) the /celune slash command with all subcommands
 * using Discord's bulk overwrite endpoint (PUT /applications/{app_id}/commands).
 *
 * Protected: requires SERVICE_ROLE_KEY in Authorization header or x-service-key header.
 */

import crypto from 'crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { registerCommands } from '@/lib/discord-api';

export const dynamic = 'force-dynamic';

const SERVICE_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

// ── Command Definitions ───────────────────────────────────────────────────

const TASK_STATUS_CHOICES = [
  { name: 'Inbox', value: 'inbox' },
  { name: 'Assigned', value: 'assigned' },
  { name: 'In Progress', value: 'in_progress' },
  { name: 'Planning', value: 'planning' },
  { name: 'Done', value: 'done' },
  { name: 'Blocked', value: 'blocked' },
  { name: 'Backlog', value: 'backlog' },
];

const PRIORITY_CHOICES = [
  { name: 'Urgent', value: 'urgent' },
  { name: 'High', value: 'high' },
  { name: 'Normal', value: 'normal' },
  { name: 'Low', value: 'low' },
];

const CELUNE_COMMAND = {
  name: 'celune',
  description: 'Celune AI — manage tasks, projects, and memory from Discord',
  options: [
    // /celune task ...
    {
      name: 'task',
      description: 'Manage tasks',
      type: 2, // SUB_COMMAND_GROUP
      options: [
        {
          name: 'list',
          description: 'List tasks by status',
          type: 1, // SUB_COMMAND
          options: [
            {
              name: 'status',
              description: 'Filter by status (default: in_progress)',
              type: 3, // STRING
              required: false,
              choices: TASK_STATUS_CHOICES,
            },
          ],
        },
        {
          name: 'create',
          description: 'Create a new task',
          type: 1,
          options: [
            {
              name: 'title',
              description: 'Task title (max 70 characters)',
              type: 3,
              required: true,
              max_length: 70,
            },
            {
              name: 'priority',
              description: 'Task priority (default: normal)',
              type: 3,
              required: false,
              choices: PRIORITY_CHOICES,
            },
          ],
        },
        {
          name: 'start',
          description: 'Start a task (set to in_progress)',
          type: 1,
          options: [
            {
              name: 'id',
              description: 'Task ID or search by title',
              type: 3,
              required: true,
              autocomplete: true,
            },
          ],
        },
        {
          name: 'done',
          description: 'Mark a task as done',
          type: 1,
          options: [
            {
              name: 'id',
              description: 'Task ID or search by title',
              type: 3,
              required: true,
              autocomplete: true,
            },
          ],
        },
      ],
    },
    // /celune memory ...
    {
      name: 'memory',
      description: 'Search agent memory',
      type: 1, // SUB_COMMAND
      options: [
        {
          name: 'query',
          description: 'Search query',
          type: 3,
          required: true,
        },
      ],
    },
    // /celune project ...
    {
      name: 'project',
      description: 'View projects',
      type: 2, // SUB_COMMAND_GROUP
      options: [
        {
          name: 'list',
          description: 'List active projects',
          type: 1,
          options: [],
        },
        {
          name: 'status',
          description: 'View project status with task progress',
          type: 1,
          options: [
            {
              name: 'name',
              description: 'Project name',
              type: 3,
              required: false,
              autocomplete: true,
            },
          ],
        },
      ],
    },
    // /celune summary [timeframe] — v2
    {
      name: 'summary',
      description: 'Summarize recent conversation in this channel',
      type: 1, // SUB_COMMAND
      options: [
        {
          name: 'timeframe',
          description: 'Time range to summarize (default: 4h)',
          type: 3, // STRING
          required: false,
          choices: [
            { name: '1 hour', value: '1h' },
            { name: '4 hours', value: '4h' },
            { name: '8 hours', value: '8h' },
            { name: '24 hours', value: '24h' },
          ],
        },
      ],
    },
  ],
};

// ── Route Handler ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Auth check: service key
  const authHeader = request.headers.get('authorization') ?? '';
  const serviceKeyHeader = request.headers.get('x-service-key') ?? '';
  const providedKey = authHeader.replace('Bearer ', '') || serviceKeyHeader;

  const expectedKey = SERVICE_KEY();
  if (!providedKey || !expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const providedBuf = Buffer.from(providedKey, 'utf-8');
  const expectedBuf = Buffer.from(expectedKey, 'utf-8');
  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await registerCommands([CELUNE_COMMAND]);

    if (!result) {
      return NextResponse.json({ error: 'Failed to register commands' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: 'Commands registered successfully',
      commands: result,
    });
  } catch (err) {
    console.error('[discord-register] Failed to register commands:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
