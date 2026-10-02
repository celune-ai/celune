import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { validateOrigin } from '@/lib/csrf';
import { isValidUuid } from '@repo/db/validation';
import { applyRateLimit, RATE_AI } from '@/lib/rate-limiter';
import { ProviderKeyRequiredError } from '@/lib/resolve-provider-key';
import {
  resolveAiExecution,
  executeViaQueue,
  IdeConnectionRequiredError,
} from '@/lib/ai-job-queue';
import { getAuthUserId, getOrgIdForUser } from '@/lib/auth';
import { voiceParseSchema } from '@/lib/schemas/voice.schema';
import { requirePermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT = `You are a voice-to-task parser. Given a spoken transcript, extract structured intents.

Respond with ONLY valid JSON (no markdown fences). The response shape:

{
  "intent": "create_task" | "update_task" | "brain_dump" | "none",
  "tasks": [
    {
      "title": "Concise imperative title (max 70 chars)",
      "description": "Optional longer description",
      "priority": "urgent" | "high" | "normal" | "low",
      "project_id": "uuid or null",
      "workspace_slug": "slug or null — only set if user explicitly names a different workspace"
    }
  ],
  "updates": [
    {
      "search_query": "fuzzy task name to match",
      "changes": { "status": "done" | "in_progress" | "review" | null, "priority": "string or null" }
    }
  ],
  "message": "Brief user-facing message about what was parsed"
}

Rules:
- "create_task": User wants to create one or more new tasks. Fill "tasks" array.
- "update_task": User wants to change existing tasks ("mark X done", "move Y to review"). Fill "updates" array.
- "brain_dump": User is speaking stream-of-consciousness — extract ALL actionable items as tasks. Fill "tasks" array.
- "none": No actionable content found. Set "message" to explain why.

Priority inference:
- Words like "critical", "urgent", "ASAP", "breaking", "outage" → "urgent"
- Words like "important", "high priority", "blocker" → "high"
- Words like "eventually", "nice to have", "low priority", "when we get to it" → "low"
- Default → "normal"

If a project context is provided, assign its ID to tasks unless the user specifies otherwise.
If the transcript is long (>50 words) or contains multiple unrelated items, treat as "brain_dump".
If workspace context is provided and the user explicitly mentions a different workspace by name, set workspace_slug on those tasks. Otherwise leave workspace_slug null (tasks go to the current workspace).`;

interface ParseRequestBody {
  transcript: string;
  context?: {
    currentProjectId?: string;
    currentProjectName?: string;
    existingProjects?: { id: string; name: string }[];
    currentWorkspaceSlug?: string;
    availableWorkspaces?: { slug: string; name: string }[];
  };
}

export interface VoiceParsedTask {
  title: string;
  description?: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  project_id: string | null;
  /** Set when user explicitly targets a different workspace */
  workspace_slug?: string | null;
}

export interface VoiceParsedUpdate {
  search_query: string;
  changes: {
    status?: string | null;
    priority?: string | null;
  };
}

export interface VoiceParseResult {
  intent: 'create_task' | 'update_task' | 'brain_dump' | 'none';
  tasks: VoiceParsedTask[];
  updates: VoiceParsedUpdate[];
  message: string;
}

const VALID_INTENTS = new Set(['create_task', 'update_task', 'brain_dump', 'none']);
const VALID_PRIORITIES = new Set(['urgent', 'high', 'normal', 'low']);

function validateParseResult(
  raw: unknown,
  allowedProjectIds: Set<string>,
): VoiceParseResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  if (!VALID_INTENTS.has(obj.intent as string)) return null;

  const tasks: VoiceParsedTask[] = [];
  if (Array.isArray(obj.tasks)) {
    for (const t of obj.tasks) {
      if (!t || typeof t !== 'object') continue;
      const task = t as Record<string, unknown>;
      if (typeof task.title !== 'string' || !task.title.trim()) continue;
      // Validate project_id is either null or a known project
      let projectId: string | null = null;
      if (typeof task.project_id === 'string' && isValidUuid(task.project_id)) {
        projectId = allowedProjectIds.has(task.project_id) ? task.project_id : null;
      }
      tasks.push({
        title: task.title.trim().slice(0, 200),
        description:
          typeof task.description === 'string' ? task.description.slice(0, 2000) : undefined,
        priority: VALID_PRIORITIES.has(task.priority as string)
          ? (task.priority as VoiceParsedTask['priority'])
          : 'normal',
        project_id: projectId,
        workspace_slug:
          typeof task.workspace_slug === 'string' ? task.workspace_slug.slice(0, 100) : null,
      });
    }
  }

  const updates: VoiceParsedUpdate[] = [];
  if (Array.isArray(obj.updates)) {
    for (const u of obj.updates) {
      if (!u || typeof u !== 'object') continue;
      const upd = u as Record<string, unknown>;
      if (typeof upd.search_query !== 'string' || !upd.search_query.trim()) continue;
      const changes = (upd.changes && typeof upd.changes === 'object' ? upd.changes : {}) as Record<
        string,
        unknown
      >;
      updates.push({
        search_query: upd.search_query.trim().slice(0, 200),
        changes: {
          status: typeof changes.status === 'string' ? changes.status : null,
          priority: typeof changes.priority === 'string' ? changes.priority : null,
        },
      });
    }
  }

  return {
    intent: obj.intent as VoiceParseResult['intent'],
    tasks,
    updates,
    message: typeof obj.message === 'string' ? obj.message.slice(0, 500) : '',
  };
}

export async function POST(request: NextRequest) {
  // CSRF validation
  const originError = await validateOrigin(request);
  if (originError) return originError;

  // Permission check — require voice:use
  const workspaceId = request.nextUrl.searchParams.get('workspace_id') ?? null;
  const permResult = await requirePermission(request, workspaceId, 'voice:use');
  if (permResult instanceof NextResponse) return permResult;

  const rateLimitResult = await applyRateLimit(request, 'voice.parse', RATE_AI);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const bodyParsed = voiceParseSchema.safeParse(rawBody);
    if (!bodyParsed.success) {
      return NextResponse.json(
        { error: bodyParsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const body = bodyParsed.data;

    // Resolve execution path
    const userId = getAuthUserId(request);
    const orgId = userId ? await getOrgIdForUser(userId) : null;

    if (!orgId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const execution = await resolveAiExecution({
      workspaceId: workspaceId ?? '',
      orgId,
      userId,
      forceDirect: !workspaceId, // No workspace = force direct
    });

    // Build allowed project IDs set for validation
    const allowedProjectIds = new Set<string>();
    if (body.context?.existingProjects?.length) {
      for (const p of body.context.existingProjects) {
        if (isValidUuid(p.id)) allowedProjectIds.add(p.id);
      }
    }

    // Build context section for the prompt
    let contextSection = '';
    if (body.context?.currentProjectId && isValidUuid(body.context.currentProjectId)) {
      const name = body.context.currentProjectName?.slice(0, 100) ?? 'Unknown';
      contextSection += `\nCurrent project: "${name}" (ID: ${body.context.currentProjectId})`;
      contextSection += '\nAssign tasks to this project unless the user says otherwise.';
    }
    if (allowedProjectIds.size > 0 && body.context?.existingProjects) {
      contextSection +=
        '\nExisting projects: ' +
        body.context.existingProjects
          .filter((p) => allowedProjectIds.has(p.id))
          .map((p) => `"${p.name.slice(0, 100)}" (${p.id})`)
          .join(', ');
    }
    if (body.context?.currentWorkspaceSlug) {
      contextSection += `\nCurrent workspace: "${body.context.currentWorkspaceSlug}"`;
    }
    if (body.context?.availableWorkspaces?.length) {
      contextSection +=
        '\nAvailable workspaces: ' +
        body.context.availableWorkspaces
          .map((w) => `"${w.name.slice(0, 100)}" (slug: ${w.slug.slice(0, 50)})`)
          .join(', ');
    }

    const userMessage = contextSection
      ? `Context:${contextSection}\n\nTranscript: "${body.transcript}"`
      : `Transcript: "${body.transcript}"`;

    // === IDE Queue Path ===
    if (execution.mode === 'ide_queue') {
      const job = await executeViaQueue({
        workspaceId: workspaceId ?? '',
        orgId,
        requesterId: userId,
        jobType: 'chat',
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: userMessage }],
        systemPrompt: SYSTEM_PROMPT,
        maxTokens: 2048,
        callbackType: 'voice_parse',
        callbackMetadata: { transcript: body.transcript.slice(0, 500) },
      });

      return NextResponse.json({
        execution_mode: 'ide_queue',
        job_id: job.id,
        status: job.status,
        message: 'Voice parse queued — your IDE will execute this request.',
      });
    }

    // === Direct API Path ===
    const client = new Anthropic({ apiKey: execution.providerKey!.key });

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = message.content[0]?.type === 'text' ? message.content[0].text : '';

    let rawParsed: unknown;
    try {
      rawParsed = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 502 });
    }

    const parsed = validateParseResult(rawParsed, allowedProjectIds);
    if (!parsed) {
      return NextResponse.json({ error: 'AI returned unexpected format' }, { status: 502 });
    }

    return NextResponse.json(parsed);
  } catch (error) {
    if (error instanceof ProviderKeyRequiredError) {
      return NextResponse.json(
        {
          error: 'provider_key_required',
          message: error.message,
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
    const isEnvError = error instanceof Error && error.message.includes('unavailable');
    return NextResponse.json(
      { error: isEnvError ? 'Voice service unavailable' : 'Internal error' },
      { status: isEnvError ? 503 : 500 },
    );
  }
}
