#!/usr/bin/env node

/**
 * Register Discord slash commands globally.
 *
 * Usage:
 *   node packages/db/scripts/register-discord-commands.mjs
 *
 * Requires DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN in apps/platform/.env.local
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(import.meta.dirname, '../../../apps/platform/.env.local');
let APP_ID = '';
let BOT_TOKEN = '';

try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    if (line.startsWith('DISCORD_APPLICATION_ID=')) APP_ID = line.split('=')[1].trim();
    if (line.startsWith('DISCORD_BOT_TOKEN=')) BOT_TOKEN = line.split('=')[1].trim();
  }
} catch {
  console.error('Failed to read .env.local');
  process.exit(1);
}

if (!APP_ID || !BOT_TOKEN) {
  console.error('Missing DISCORD_APPLICATION_ID or DISCORD_BOT_TOKEN');
  process.exit(1);
}

const commands = [
  {
    name: 'celune',
    description: 'Celune workspace commands',
    options: [
      {
        name: 'task',
        description: 'Task management',
        type: 2, // SUB_COMMAND_GROUP
        options: [
          {
            name: 'list',
            description: 'List tasks',
            type: 1, // SUB_COMMAND
            options: [
              {
                name: 'status',
                description: 'Filter by status',
                type: 3, // STRING
                choices: [
                  { name: 'In Progress', value: 'in_progress' },
                  { name: 'Inbox', value: 'inbox' },
                  { name: 'Done', value: 'done' },
                  { name: 'Assigned', value: 'assigned' },
                  { name: 'Blocked', value: 'blocked' },
                ],
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
                description: 'Task title',
                type: 3,
                required: true,
              },
              {
                name: 'priority',
                description: 'Priority level',
                type: 3,
                choices: [
                  { name: 'Urgent', value: 'urgent' },
                  { name: 'High', value: 'high' },
                  { name: 'Normal', value: 'normal' },
                  { name: 'Low', value: 'low' },
                ],
              },
            ],
          },
          {
            name: 'start',
            description: 'Start a task',
            type: 1,
            options: [
              {
                name: 'id',
                description: 'Task ID',
                type: 3,
                required: true,
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
                description: 'Task ID',
                type: 3,
                required: true,
              },
            ],
          },
        ],
      },
      {
        name: 'memory',
        description: 'Search workspace memory',
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
      {
        name: 'project',
        description: 'View project status',
        type: 1, // SUB_COMMAND
      },
    ],
  },
];

console.log('Registering Discord slash commands...');

const res = await fetch(`https://discord.com/api/v10/applications/${APP_ID}/commands`, {
  method: 'PUT',
  headers: {
    Authorization: `Bot ${BOT_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(commands),
});

if (!res.ok) {
  const err = await res.text();
  console.error('Failed to register commands:', res.status, err);
  process.exit(1);
}

const registered = await res.json();
console.log(`Registered ${registered.length} commands:`);
for (const cmd of registered) {
  console.log(`  /${cmd.name} (${cmd.id})`);
}
