/**
 * MCP Tool Registry.
 *
 * The package supplies the tools that run on @celuneai/core; the platform adds
 * memory, onboarding, GitHub review sync, and its onboarding-aware whoami.
 */

import {
  CORE_TOOLS,
  getAvailableTools as filterByScope,
  mergeTools,
  type AuthContext,
} from '@celuneai/api';
import type { McpToolHandler, ToolContext } from './types';

// Import each tool directly — barrel exports via index.ts fail under Turbopack
import { recallMemory } from './tools/memory/recall-memory';
import { searchCodeExamples } from './tools/memory/search-code-examples';
import { listMemories } from './tools/memory/list-memories';
import { storeMemory } from './tools/memory/store-memory';
import { graphContext } from './tools/memory/graph-context';
import { getOnboardingConversation } from './tools/onboarding/get-onboarding-conversation';
import { sendOnboardingMessage } from './tools/onboarding/send-onboarding-message';
import { whoami } from './tools/workspace/whoami';
import { syncPrReview } from './tools/workspace/sync-pr-review';

/** Platform-only tools; whoami replaces the package version by name. */
export const PLATFORM_EXTRA_TOOLS: McpToolHandler[] = [
  recallMemory,
  searchCodeExamples,
  listMemories,
  storeMemory,
  graphContext,
  getOnboardingConversation,
  sendOnboardingMessage,
  whoami,
  syncPrReview,
];

/** All registered tool handlers. */
const ALL_TOOLS: McpToolHandler[] = mergeTools<ToolContext>(
  CORE_TOOLS as McpToolHandler[],
  PLATFORM_EXTRA_TOOLS,
);

/**
 * Get all tools available for a given caller.
 * Filters by scope — only returns tools the caller has permission to use.
 */
export function getAvailableTools(auth: AuthContext): McpToolHandler[] {
  return filterByScope(auth, ALL_TOOLS);
}

/**
 * Get total count of registered tools.
 */
export function getToolCount(): number {
  return ALL_TOOLS.length;
}
