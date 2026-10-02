/**
 * Platform wiring for @celuneai/core: one services bundle per Supabase client,
 * the edition's Gate, and the CoreError to HTTP mapping.
 */

import { NextResponse } from 'next/server';
import {
  createServices,
  createScope,
  isCoreError,
  type Gate,
  type Services,
  type WorkspaceScope,
} from '@celuneai/core';
import { SupabaseAttachmentBlobs, SupabaseStore } from '@celuneai/core/supabase';
import { createPlatformGate } from '@/lib/gate';

type SupabaseClient = ConstructorParameters<typeof SupabaseStore>[0];

export function getCoreServices(
  supabase: SupabaseClient,
  gate: Gate = createPlatformGate(),
): Services {
  return createServices(new SupabaseStore(supabase), {
    gate,
    attachmentBlobs: new SupabaseAttachmentBlobs(supabase),
  });
}

export function workspaceScope(input: {
  workspaceId: string;
  orgId?: string | null;
  actorId?: string | null;
}): WorkspaceScope {
  return createScope(input);
}

/** Maps a CoreError to the JSON shape routes already return; null for other errors. */
export function coreErrorResponse(error: unknown): NextResponse | null {
  if (!isCoreError(error)) return null;
  if (error.code === 'gate_denied' && error.details) {
    return NextResponse.json(error.details, { status: error.status });
  }
  if (error.code === 'not_found') {
    return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
  }
  return NextResponse.json({ error: error.message }, { status: error.status });
}
