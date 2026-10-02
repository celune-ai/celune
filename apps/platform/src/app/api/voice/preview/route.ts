import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { resolveVoiceProvider } from '@/lib/voice-providers/resolve';
import { isValidProvider } from '@/lib/voice-providers';
import { getOrgIdForUser } from '@/lib/auth';
import { requirePermission } from '@/lib/permissions';
import { z } from 'zod';
import type { VoiceSettings, VoiceProvider } from '@repo/types';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';

import { applyRateLimit, RATE_AI } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

const previewSchema = z.object({
  voice_id: z.string().min(1).max(100),
  text: z.string().min(1).max(500).optional(),
  provider: z.string().min(1).max(50).optional(),
  params: z
    .object({
      stability: z.number().min(0).max(1).optional(),
      similarity_boost: z.number().min(0).max(1).optional(),
      style: z.number().min(0).max(1).optional(),
      speed: z.number().min(0.25).max(4).optional(),
      speaker_boost: z.boolean().optional(),
      model_id: z.string().optional(),
    })
    .optional(),
});

/**
 * POST /api/voice/preview
 * Generate a short TTS preview for a given voice_id. Requires authentication.
 * Returns audio/mpeg binary.
 */
export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'voice.preview.post', RATE_AI);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  // Permission check — require voice:use
  const workspaceId = request.nextUrl.searchParams.get('workspace_id') ?? null;
  const permResult = await requirePermission(request, workspaceId, 'voice:use');
  if (permResult instanceof NextResponse) return permResult;
  const userId = permResult.userId;

  try {
    const body = await request.json();
    const parsed = previewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const { voice_id, text, params } = parsed.data;
    const previewText = text ?? 'Hello, this is a preview of my voice.';
    const providerName = parsed.data.provider ?? 'elevenlabs';

    // Validate provider name before use
    if (!isValidProvider(providerName)) {
      return NextResponse.json({ error: 'Unsupported voice provider' }, { status: 400 });
    }

    // Resolve provider + API key (BYOK → platform fallback)
    const orgId = await getOrgIdForUser(userId);
    const { provider, apiKey } = await resolveVoiceProvider(
      { provider: providerName as VoiceProvider } as VoiceSettings,
      orgId,
      undefined,
      { userId },
    );

    const result = await provider.generateSpeech(
      voice_id,
      previewText,
      {
        stability: params?.stability,
        similarity_boost: params?.similarity_boost,
        style: params?.style,
        speed: params?.speed,
        speaker_boost: params?.speaker_boost,
        model_id: params?.model_id,
      },
      apiKey,
    );

    return new NextResponse(result.audio, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
