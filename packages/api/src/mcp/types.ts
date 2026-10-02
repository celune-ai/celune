import type { Services } from '@celuneai/core';
import type { z } from 'zod';
import type { ApiScope, AuthContext } from '../auth/types.ts';
import type { ApiHost } from '../host.ts';

export type McpToolScope = ApiScope | 'public';

export type McpToolGroup = 'tasks' | 'projects' | 'memory' | 'onboarding' | 'workspace' | 'jobs';

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

/** What every package tool receives; hosts extend it for their own tools. */
export interface ToolContext {
  auth: AuthContext;
  services: Services;
  host: ApiHost;
}

export interface McpToolHandler<Ctx extends ToolContext = ToolContext> {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: z.ZodObject<any>;
  /** Minimum scope; 'public' is always listed. */
  scope: McpToolScope;
  group: McpToolGroup;
  execute(params: Record<string, unknown>, ctx: Ctx): Promise<McpToolResult>;
}

export function textResult(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

export function errorResult(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

export function jsonResult(value: unknown): McpToolResult {
  return textResult(JSON.stringify(value, null, 2));
}
