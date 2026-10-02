/**
 * GET /api/cron/jobs — List cron jobs for a workspace
 * PATCH /api/cron/jobs — Toggle a cron job's enabled status
 *
 * Auth: workspace membership required
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import { RATE_READ, RATE_WRITE } from '@/lib/rate-limiter';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const toggleCronJobSchema = z
  .object({
    job_id: z.string().min(1).max(200),
    enabled: z.boolean(),
  })
  .strip();

type ToggleCronJobBody = z.infer<typeof toggleCronJobSchema>;

export const GET = withApiSecurity(
  async (request: NextRequest, { userId }: SecurityContext) => {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspace_id');

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Verify membership
    const { data: membership } = await supabase
      .from('workspace_memberships')
      .select('workspace_id')
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { data: jobs, error } = await supabase
      .from('cron_jobs')
      .select(
        'job_id, display_name, schedule_description, schedule_seconds, last_run_at, last_run_status, last_error, enabled, updated_at',
      )
      .eq('workspace_id', workspaceId)
      .order('display_name');

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch cron jobs' }, { status: 500 });
    }

    return NextResponse.json({ jobs: jobs ?? [] });
  },
  { rateLimit: { tier: RATE_READ, routeKey: 'cron-jobs-list' } },
);

export const PATCH = withApiSecurity<ToggleCronJobBody>(
  async (request: NextRequest, { userId, body }: SecurityContext<ToggleCronJobBody>) => {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspace_id');

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Verify membership
    const { data: membership } = await supabase
      .from('workspace_memberships')
      .select('workspace_id')
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Verify job belongs to this workspace
    const { data: job } = await supabase
      .from('cron_jobs')
      .select('job_id, workspace_id')
      .eq('job_id', body.job_id)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const { error } = await supabase
      .from('cron_jobs')
      .update({ enabled: body.enabled, updated_at: new Date().toISOString() })
      .eq('job_id', body.job_id);

    if (error) {
      return NextResponse.json({ error: 'Failed to update job' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  },
  {
    rateLimit: { tier: RATE_WRITE, routeKey: 'cron-jobs-toggle' },
    parseBody: toggleCronJobSchema,
  },
);
