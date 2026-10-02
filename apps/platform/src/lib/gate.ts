/**
 * Gate selection for the platform: NoopGate for a community self-host, the
 * Celune Cloud gate (suspension + plan limits) for the cloud edition.
 */

import { NoopGate, type Gate } from '@celuneai/core';
import { resolveHostConfig, type HostEnv } from '@celuneai/core/config';
import { CloudGate, type CloudGateDeps, type PlanDenial } from '@celuneai/ee-gates';
import { createServiceClient } from '@repo/db/service';
import { enforcePlanLimit, requireActivePlan } from '@/lib/plan-enforcement';

const planLimit: CloudGateDeps['planLimit'] = async (ctx, check) => {
  const blocked = await enforcePlanLimit(ctx, check);
  if (!blocked) return null;
  const body = (await blocked.json()) as Record<string, unknown>;
  return { status: blocked.status === 402 ? 402 : 403, body } satisfies PlanDenial;
};

// API and MCP calls check the paywall on every request; a short cache keeps that to one plan
// resolution per workspace and caller at a time. A new subscription shows within the TTL.
const PAYWALL_CACHE_TTL_MS = 30_000;
const paywallCache = new Map<string, { denial: PlanDenial | null; expires: number }>();

const paywall: NonNullable<CloudGateDeps['paywall']> = async (ctx) => {
  const key = `${ctx.workspaceId}:${ctx.userId ?? ''}`;
  const cached = paywallCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.denial;
  const blocked = await requireActivePlan(ctx);
  const denial: PlanDenial | null = blocked
    ? { status: 402, body: (await blocked.json()) as Record<string, unknown> }
    : null;
  if (paywallCache.size >= 1000) paywallCache.clear();
  paywallCache.set(key, { denial, expires: Date.now() + PAYWALL_CACHE_TTL_MS });
  return denial;
};

// Service client: suspension is read before the user's row access is established. Accesses: workspaces.metadata.
const workspaceMetadata: CloudGateDeps['workspaceMetadata'] = async (workspaceId) => {
  const { data } = await createServiceClient()
    .from('workspaces')
    .select('metadata')
    .eq('id', workspaceId)
    .single();
  return (data?.metadata as Record<string, unknown> | null) ?? null;
};

// Service client: trial budget is read before any key is chosen. Accesses: workspaces.trial_token_budget, trial_tokens_used.
const trialBudget: NonNullable<CloudGateDeps['trialBudget']> = async (workspaceId) => {
  const { data } = await createServiceClient()
    .from('workspaces')
    .select('trial_token_budget, trial_tokens_used')
    .eq('id', workspaceId)
    .maybeSingle();
  if (!data) return null;
  return { budget: data.trial_token_budget ?? 50000, used: data.trial_tokens_used ?? 0 };
};

export function createCloudGate(
  deps: CloudGateDeps = { planLimit, paywall, workspaceMetadata, trialBudget },
): Gate {
  return new CloudGate(deps);
}

export function createPlatformGate(env: HostEnv = process.env): Gate {
  return resolveHostConfig(env).gateMode === 'cloud' ? createCloudGate() : new NoopGate();
}
