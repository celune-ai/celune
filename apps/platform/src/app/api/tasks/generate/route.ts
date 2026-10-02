import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@repo/db/server';
import { createTask, createActivity } from '@repo/db/queries';
import { RATE_AI } from '@/lib/rate-limiter';
import { ProviderKeyRequiredError } from '@/lib/resolve-provider-key';
import { recordLlmUsage } from '@/lib/ai-budget';
import {
  resolveAiExecution,
  executeViaQueue,
  IdeConnectionRequiredError,
} from '@/lib/ai-job-queue';
import { getOrgIdForUser } from '@/lib/auth';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import { taskGenerateSchema } from '@/lib/schemas/onboarding.schema';
import type { z } from 'zod';

type TaskGenerateBody = z.infer<typeof taskGenerateSchema>;

const SYSTEM_PROMPT = `You are a task creation assistant. Given a natural language description, generate a structured task as JSON with these fields:

- "title": Concise, imperative task title (max 70 characters).
- "description": ALWAYS include a markdown description. Use natural prose — explain what needs to be done, why it matters, and a suggested approach. Keep it concise but useful (3-8 sentences). Never leave this empty.
- "priority": One of "urgent", "high", "normal", "low". Default to "normal".
- "assignee": Default to "unassigned".

Respond with ONLY valid JSON, no markdown fences or extra text.`;

export const POST = withApiSecurity<TaskGenerateBody>(
  async (request: NextRequest, { userId, body }: SecurityContext<TaskGenerateBody>) => {
    const prompt = body.prompt;
    const projectId = body.project_id;
    const workspaceId = body.workspace_id;

    // Resolve execution path
    const orgId = userId ? await getOrgIdForUser(userId) : null;
    if (!orgId || !workspaceId) {
      return NextResponse.json({ error: 'Workspace context required' }, { status: 403 });
    }

    let execution;
    try {
      execution = await resolveAiExecution({
        workspaceId,
        orgId,
        userId: userId!,
      });
    } catch (error) {
      if (error instanceof ProviderKeyRequiredError) {
        return NextResponse.json(
          {
            error: 'provider_key_required',
            message: error.trialExhausted
              ? 'Your starter tokens are used up. Add an API key in Settings to continue.'
              : 'Add an AI provider key in Settings to use this feature.',
            provider: error.provider,
            trial_exhausted: error.trialExhausted,
          },
          { status: 402 },
        );
      }
      if (error instanceof IdeConnectionRequiredError) {
        return NextResponse.json(
          {
            error: 'ide_connection_required',
            message: 'Connect your IDE or add an API key to use this feature.',
          },
          { status: 402 },
        );
      }
      throw error;
    }

    // === IDE Queue Path ===
    if (execution.mode === 'ide_queue') {
      const job = await executeViaQueue({
        workspaceId,
        orgId,
        requesterId: userId!,
        jobType: 'chat',
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: prompt.trim() }],
        systemPrompt: SYSTEM_PROMPT,
        maxTokens: 1024,
        callbackType: 'task_gen',
        callbackMetadata: { projectId, prompt: prompt.trim().slice(0, 500) },
      });

      return NextResponse.json({
        execution_mode: 'ide_queue',
        job_id: job.id,
        status: job.status,
        message: 'Task generation queued — your IDE will execute this request.',
      });
    }

    // === Direct API Path ===
    const client = new Anthropic({ apiKey: execution.providerKey!.key });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt.trim() }],
    });
    recordLlmUsage({
      workspaceId,
      orgId,
      userId,
      provider: 'anthropic',
      model: message.model,
      source: execution.providerKey!.source,
      feature: 'task_generate',
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    });

    const textBlock = message.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'No text response from AI' }, { status: 500 });
    }

    const parsed = JSON.parse(textBlock.text);
    const title = String(parsed.title ?? '').slice(0, 70);
    const description = String(parsed.description ?? '') || prompt.trim();
    const priority = ['urgent', 'high', 'normal', 'low'].includes(parsed.priority)
      ? parsed.priority
      : 'normal';
    const assignee = parsed.assignee ?? 'unassigned';

    const supabase = await createClient();
    const task = await createTask(supabase, {
      title,
      description,
      priority,
      assignee,
      status: 'inbox',
      ...(projectId ? { project_id: projectId } : {}),
    });

    await createActivity(supabase, {
      event_type: 'created',
      severity: 'info',
      source: 'ai-generate',
      title: `Task created: ${title}`,
      task_id: task.id,
      agent_id: 'rick',
      details: { prompt: prompt.trim().slice(0, 500) },
      workspace_id: workspaceId,
    });

    return NextResponse.json(task, { status: 201 });
  },
  {
    rateLimit: { tier: RATE_AI, routeKey: 'tasks.generate' },
    parseBody: taskGenerateSchema,
    permission: 'tasks:create',
  },
);
