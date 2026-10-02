import { z } from 'zod';
import type {
  VoiceProvider,
  ElevenLabsModel,
  AudioOutputFormat,
  TextNormalization,
} from '@repo/types';

export const voiceSettingsSchema = z
  .object({
    provider: z.enum(['elevenlabs', 'openai'] satisfies [VoiceProvider, ...VoiceProvider[]]),
    voice_id: z.string().min(1),
    voice_name: z.string().min(1),
    params: z
      .object({
        stability: z.number().min(0).max(1).optional(),
        similarity_boost: z.number().min(0).max(1).optional(),
        style: z.number().min(0).max(1).optional(),
        speed: z.number().min(0.5).max(2).optional(),
        speaker_boost: z.boolean().optional(),
        model_id: z
          .enum([
            'eleven_multilingual_v2',
            'eleven_turbo_v2_5',
            'eleven_flash_v2_5',
            'eleven_v3',
          ] satisfies [ElevenLabsModel, ...ElevenLabsModel[]])
          .optional(),
        output_format: z
          .enum(['mp3_44100_128', 'pcm_16000', 'ogg_opus'] satisfies [
            AudioOutputFormat,
            ...AudioOutputFormat[],
          ])
          .optional(),
        text_normalization: z
          .enum(['auto', 'on', 'off'] satisfies [TextNormalization, ...TextNormalization[]])
          .optional(),
        volume_normalization: z.boolean().optional(),
      })
      .optional(),
    system_prompt: z.string().max(5000).optional(),
  })
  .strip();

export const ttsRequestSchema = z
  .object({
    voice_id: z.string().min(1),
    text: z.string().max(5000).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    previous_text: z.string().max(5000).optional(),
    workspace_id: z.string().uuid().optional(),
  })
  .strip();

export const voicePreviewSchema = z
  .object({
    voice_id: z.string().min(1),
    text: z.string().max(5000).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strip();

export const voiceParseSchema = z
  .object({
    transcript: z.string().min(1).max(10_000),
    context: z
      .object({
        currentProjectId: z.string().optional(),
        currentProjectName: z.string().optional(),
        existingProjects: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
        currentWorkspaceSlug: z.string().optional(),
        availableWorkspaces: z.array(z.object({ slug: z.string(), name: z.string() })).optional(),
      })
      .optional(),
  })
  .strip();
