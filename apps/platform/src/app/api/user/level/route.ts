import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { safeErrorResponse } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * Minimal leveling system:
 * Level 1: Account created (default)
 * Level 2: MCP connected (first API key created + used)
 * Level 3: First project completed
 *
 * Level is stored as agent_memory with key "user-level:{user_id}"
 */

interface LevelCheck {
  level: number;
  check: string;
}

const LEVEL_CHECKS: LevelCheck[] = [
  { level: 1, check: 'signup' },
  { level: 2, check: 'mcp_connected' },
  { level: 3, check: 'project_completed' },
];

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Check current level from memory
    const { data: levelMemory } = await supabase
      .from('agent_memory')
      .select('content')
      .eq('user_id', user.id)
      .eq('key', `user-level:${user.id}`)
      .maybeSingle();

    let currentLevel = 1; // Default: signed up
    if (levelMemory) {
      const match = levelMemory.content.match(/level:(\d+)/);
      if (match) currentLevel = parseInt(match[1]!, 10);
    }

    // Check if user should level up
    if (currentLevel < 2) {
      // Check for API key usage (MCP connected)
      const { data: apiKeys } = await supabase
        .from('api_keys')
        .select('id, last_used_at')
        .eq('user_id', user.id)
        .not('last_used_at', 'is', null)
        .limit(1);

      if (apiKeys && apiKeys.length > 0) {
        currentLevel = 2;
      }
    }

    if (currentLevel < 3) {
      // Check for completed project
      const { data: projects } = await supabase
        .from('projects')
        .select('id')
        .eq('user_id', user.id)
        .eq('project_status', 'completed')
        .limit(1);

      if (projects && projects.length > 0) {
        currentLevel = 3;
      }
    }

    // Persist level if changed
    if (levelMemory) {
      const stored = parseInt(levelMemory.content.match(/level:(\d+)/)?.[1] ?? '1', 10);
      if (currentLevel > stored) {
        await supabase
          .from('agent_memory')
          .update({ content: `level:${currentLevel}` })
          .eq('user_id', user.id)
          .eq('key', `user-level:${user.id}`);
      }
    } else {
      await supabase.from('agent_memory').insert({
        key: `user-level:${user.id}`,
        content: `level:${currentLevel}`,
        category: 'fact',
        memory_type: 'fact',
        source: 'leveling',
        user_id: user.id,
        importance_score: 0.5,
      });
    }

    return NextResponse.json({
      level: currentLevel,
      max_level: LEVEL_CHECKS.length,
      checks: LEVEL_CHECKS.map((c) => ({
        ...c,
        completed: c.level <= currentLevel,
      })),
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
