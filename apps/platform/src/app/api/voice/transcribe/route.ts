import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateOrigin } from '@/lib/csrf';
import { applyRateLimit, RATE_AI } from '@/lib/rate-limiter';
import { resolveProviderKey, ProviderKeyRequiredError } from '@/lib/resolve-provider-key';
import { getAuthUserId, getOrgIdForUser } from '@/lib/auth';
import { requirePermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

const MAX_AUDIO_SIZE = 25 * 1024 * 1024; // 25MB (OpenAI Whisper limit)
const ALLOWED_MIME_TYPES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/x-m4a',
  'audio/aac',
  'audio/flac',
]);

export async function POST(request: NextRequest) {
  const originError = await validateOrigin(request);
  if (originError) return originError;

  // Permission check — require voice:use
  const workspaceId = request.nextUrl.searchParams.get('workspace_id') ?? null;
  const permResult = await requirePermission(request, workspaceId, 'voice:use');
  if (permResult instanceof NextResponse) return permResult;

  const rateLimitResult = await applyRateLimit(request, 'voice.transcribe', RATE_AI);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio');

    if (!audioFile || !(audioFile instanceof Blob)) {
      return NextResponse.json({ error: 'audio field is required' }, { status: 400 });
    }

    if (audioFile.size === 0) {
      return NextResponse.json({ error: 'Audio file is empty' }, { status: 400 });
    }

    if (audioFile.size > MAX_AUDIO_SIZE) {
      return NextResponse.json({ error: 'Audio file too large (max 25MB)' }, { status: 413 });
    }

    const mimeType = audioFile.type.split(';')[0].trim();
    if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json({ error: 'Unsupported audio format' }, { status: 415 });
    }

    // Resolve OpenAI key (BYOK → platform fallback)
    const userId = getAuthUserId(request);
    const orgId = userId ? await getOrgIdForUser(userId) : null;

    let apiKey: string;
    if (orgId) {
      const resolved = await resolveProviderKey('openai', orgId, undefined, {
        userId: userId ?? undefined,
      });
      apiKey = resolved.key;
    } else {
      const platformKey = process.env.OPENAI_API_KEY;
      if (!platformKey) throw new Error('Whisper service unavailable');
      apiKey = platformKey;
    }

    const whisperForm = new FormData();
    whisperForm.append('file', audioFile, 'recording.webm');
    whisperForm.append('model', 'whisper-1');
    whisperForm.append('language', 'en');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: whisperForm,
    });

    if (!whisperRes.ok) {
      const errText = await whisperRes.text().catch(() => '');
      console.error('[Whisper] API error:', whisperRes.status, errText);
      return NextResponse.json({ error: 'Transcription failed' }, { status: 502 });
    }

    const data = (await whisperRes.json()) as { text?: string };
    const transcript = typeof data.text === 'string' ? data.text.trim() : '';

    return NextResponse.json({ transcript });
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
    const isEnvError = error instanceof Error && error.message.includes('unavailable');
    return NextResponse.json(
      { error: isEnvError ? 'Whisper service unavailable' : 'Internal error' },
      { status: isEnvError ? 503 : 500 },
    );
  }
}
