import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { safeErrorResponse } from '@/lib/api-error';
import { cachedJson } from '@/lib/api-cache';
import { requirePlatformOwner } from '@/lib/permissions';
import { applyRateLimit, RATE_AI } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

const VERCEL_API = 'https://api.vercel.com';

interface VercelDeployment {
  uid: string;
  name: string;
  state: string;
  created: number;
  buildingAt?: number;
  ready?: number;
  source?: string;
  meta?: Record<string, string>;
}

interface ProjectDeploymentStats {
  project: string;
  total: number;
  ready: number;
  error: number;
  successRate: number;
  avgBuildTimeSec: number | null;
  lastDeployed: string | null;
  lastCommitMessage: string | null;
}

interface DeploymentTrend {
  date: string;
  total: number;
  ready: number;
  error: number;
}

/**
 * Aggregates Vercel deployment data across all projects.
 * Returns per-project stats, daily deployment trends, and recent deployments.
 */
export async function GET(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'analytics.vercel.get', RATE_AI);
  if (rateLimitResult) return rateLimitResult.blocked;

  const authResult = await requirePlatformOwner(request);
  if (authResult instanceof NextResponse) return authResult;

  const token = process.env.VERCEL_API_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'VERCEL_API_TOKEN not configured' }, { status: 500 });
  }

  try {
    const headers = { Authorization: `Bearer ${token}` };

    // Fetch projects to get team ID
    const projRes = await fetch(`${VERCEL_API}/v9/projects?limit=10`, { headers });
    if (!projRes.ok) throw new Error(`Projects API: ${projRes.status}`);
    const projData = await projRes.json();
    const teamId = projData.projects?.[0]?.accountId;

    // Fetch last 100 deployments
    const depsUrl = teamId
      ? `${VERCEL_API}/v6/deployments?teamId=${teamId}&limit=100`
      : `${VERCEL_API}/v6/deployments?limit=100`;
    const depsRes = await fetch(depsUrl, { headers });
    if (!depsRes.ok) throw new Error(`Deployments API: ${depsRes.status}`);
    const depsData = await depsRes.json();
    const deployments: VercelDeployment[] = depsData.deployments ?? [];

    // Per-project stats
    const byProject = new Map<string, VercelDeployment[]>();
    for (const d of deployments) {
      const name = d.name || 'unknown';
      if (!byProject.has(name)) byProject.set(name, []);
      byProject.get(name)!.push(d);
    }

    const projectStats: ProjectDeploymentStats[] = [];
    for (const [project, deps] of byProject) {
      const ready = deps.filter((d) => d.state === 'READY').length;
      const error = deps.filter((d) => d.state === 'ERROR').length;

      // Avg build time for successful deploys
      const buildTimes = deps
        .filter((d) => d.state === 'READY' && d.buildingAt && d.ready)
        .map((d) => (d.ready! - d.buildingAt!) / 1000);
      const avgBuildTimeSec =
        buildTimes.length > 0
          ? Math.round(buildTimes.reduce((a, b) => a + b, 0) / buildTimes.length)
          : null;

      const latest = deps[0];

      projectStats.push({
        project,
        total: deps.length,
        ready,
        error,
        successRate: deps.length > 0 ? Math.round((ready / deps.length) * 100) : 0,
        avgBuildTimeSec,
        lastDeployed: latest ? new Date(latest.created).toISOString() : null,
        lastCommitMessage: latest?.meta?.githubCommitMessage?.split('\n')[0] ?? null,
      });
    }

    // Daily deployment trend (last 30 days)
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const recentDeps = deployments.filter((d) => d.created >= thirtyDaysAgo);

    const dailyMap = new Map<string, { total: number; ready: number; error: number }>();
    for (const d of recentDeps) {
      const date = new Date(d.created).toISOString().split('T')[0];
      const entry = dailyMap.get(date) ?? { total: 0, ready: 0, error: 0 };
      entry.total++;
      if (d.state === 'READY') entry.ready++;
      if (d.state === 'ERROR') entry.error++;
      dailyMap.set(date, entry);
    }

    const trend: DeploymentTrend[] = Array.from(dailyMap.entries())
      .map(([date, stats]) => ({ date, ...stats }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Recent deployments (last 10)
    const recent = deployments.slice(0, 10).map((d) => ({
      uid: d.uid,
      project: d.name,
      state: d.state,
      created: new Date(d.created).toISOString(),
      buildTimeSec:
        d.state === 'READY' && d.buildingAt && d.ready
          ? Math.round((d.ready - d.buildingAt) / 1000)
          : null,
      source: d.source ?? null,
      commitMessage: d.meta?.githubCommitMessage?.split('\n')[0] ?? null,
      commitAuthor: d.meta?.githubCommitAuthorName ?? null,
    }));

    // Summary KPIs
    const totalDeploys = deployments.length;
    const totalReady = deployments.filter((d) => d.state === 'READY').length;
    const totalError = deployments.filter((d) => d.state === 'ERROR').length;
    const overallSuccessRate = totalDeploys > 0 ? Math.round((totalReady / totalDeploys) * 100) : 0;

    return cachedJson({
      summary: {
        totalDeploys,
        totalReady,
        totalError,
        overallSuccessRate,
        projectCount: byProject.size,
      },
      projects: projectStats.sort((a, b) => b.total - a.total),
      trend,
      recent,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
