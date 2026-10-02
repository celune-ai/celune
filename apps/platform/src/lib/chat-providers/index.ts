/**
 * Unified chat provider routing.
 *
 * Resolves the correct chat provider based on detected SDK type
 * from the user's API key prefix.
 */

export type { ChatMessage, StreamChatOptions, StreamChatResult, ChatProvider } from './types';

import type { SdkType } from '@/lib/provider-detection';
import type { ChatProvider } from './types';

import { anthropicProvider } from './anthropic';
import { openaiCompatibleProvider } from './openai-compatible';
import { googleGeminiProvider } from './google-gemini';

const PROVIDERS: Record<SdkType, ChatProvider> = {
  anthropic: anthropicProvider,
  'openai-compatible': openaiCompatibleProvider,
  'google-gemini': googleGeminiProvider,
};

/** Get the chat provider for a given SDK type. */
export function getChatProvider(sdkType: SdkType): ChatProvider {
  return PROVIDERS[sdkType];
}
