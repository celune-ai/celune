/**
 * Platform-side MCP tool types: the package contract plus the service-role
 * Supabase client the platform-only tools (memory, onboarding, GitHub) need.
 */

import type {
  McpToolHandler as PackageToolHandler,
  ToolContext as PackageToolContext,
} from '@celuneai/api';
import type { createServiceClient } from '@repo/db/service';

export type { McpToolGroup, McpToolResult, McpToolScope } from '@celuneai/api';
export { errorResult, textResult } from '@celuneai/api';

export interface ToolContext extends PackageToolContext {
  supabase: ReturnType<typeof createServiceClient>;
}

export type McpToolHandler = PackageToolHandler<ToolContext>;
