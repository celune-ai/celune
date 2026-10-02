-- Seed initial skill packs for the Celune marketplace
-- Part of: Brain Manifest / Skill Packs (project c401cdd1)

-- 20260322_skill_packs_and_manifest_extension.sql creates the table and sorts after this
-- file, so the seed only runs when the table already exists.
DO $seed$
BEGIN
  IF to_regclass('public.skill_packs') IS NULL THEN
    RAISE NOTICE 'skill_packs missing; seed skipped';
    RETURN;
  END IF;
  EXECUTE $sql$
INSERT INTO skill_packs (slug, name, description, pack_category, min_tier, version, author, icon, tags, is_published, is_official, skill_entries, team_type_affinity)
VALUES

-- =========================================================================
-- 1. Core Workflow Pack (Builder)
-- =========================================================================
(
  'core-workflow',
  'Core Workflow',
  'Essential day-to-day skills: task management, project creation, session rituals, and context refresh. The foundation every workspace needs.',
  'workflow',
  'builder',
  '1.0.0',
  'celune',
  'Layers',
  ARRAY['workflow', 'tasks', 'projects', 'session', 'essential'],
  true,
  true,
  '[
    {"path": "skills/task/CLAUDE.md", "category": "skill", "tier": "essential", "description": "Create inbox tasks from analysis"},
    {"path": "skills/project/CLAUDE.md", "category": "skill", "tier": "essential", "description": "Create full projects with structured briefs"},
    {"path": "skills/project-plan/CLAUDE.md", "category": "skill", "tier": "essential", "description": "Lightweight plan project lifecycle"},
    {"path": "skills/refresh/CLAUDE.md", "category": "skill", "tier": "essential", "description": "Re-sync workspace context"},
    {"path": "skills/quick-flush/CLAUDE.md", "category": "skill", "tier": "essential", "description": "Mid-session memory save"},
    {"path": "skills/closing-time/CLAUDE.md", "category": "skill", "tier": "essential", "description": "End-of-session ritual with memory persistence"},
    {"path": "skills/todays-project/CLAUDE.md", "category": "skill", "tier": "essential", "description": "Daily prioritized task list"},
    {"path": "skills/lean/CLAUDE.md", "category": "skill", "tier": "essential", "description": "Minimal context mode for performance"}
  ]'::jsonb,
  '{"web-app": 1, "mobile": 1, "ai-ml": 1, "content": 1, "fullstack": 1, "other": 1}'::jsonb
),

-- =========================================================================
-- 2. Git & DevOps Pack (Builder)
-- =========================================================================
(
  'git-devops',
  'Git & DevOps',
  'Branch management, PR creation, and full deploy pipeline. Essential for teams using GitHub.',
  'devops',
  'builder',
  '1.0.0',
  'celune',
  'GitBranch',
  ARRAY['git', 'github', 'deployment', 'ci', 'devops'],
  true,
  true,
  '[
    {"path": "skills/git-branch/CLAUDE.md", "category": "skill", "tier": "essential", "description": "Create branches with merged-branch safety check"},
    {"path": "skills/git-push/CLAUDE.md", "category": "skill", "tier": "essential", "description": "Push to branch and create PR"},
    {"path": "skills/git-deploy/CLAUDE.md", "category": "skill", "tier": "essential", "description": "Full deploy pipeline (PR, CI, merge)"}
  ]'::jsonb,
  '{"web-app": 1, "mobile": 1, "fullstack": 1, "ai-ml": 2, "other": 2}'::jsonb
),

-- =========================================================================
-- 3. Build & Ship Pack (Builder + Pro)
-- =========================================================================
(
  'build-and-ship',
  'Build & Ship',
  'End-to-end project execution with structured QA, deep build verification loops, and full lifecycle management.',
  'workflow',
  'builder',
  '1.0.0',
  'celune',
  'Rocket',
  ARRAY['build', 'ship', 'qa', 'verification', 'lifecycle'],
  true,
  true,
  '[
    {"path": "skills/build/CLAUDE.md", "category": "skill", "tier": "essential", "description": "Execute projects end-to-end with full lifecycle"},
    {"path": "skills/deep-build/CLAUDE.md", "category": "skill", "tier": "standard", "description": "Iterative verification loop for complex tasks"},
    {"path": "skills/security-audit/CLAUDE.md", "category": "skill", "tier": "essential", "description": "Full security scan with task creation"}
  ]'::jsonb,
  '{"web-app": 1, "fullstack": 1, "mobile": 1, "ai-ml": 2, "content": 3, "other": 2}'::jsonb
),

-- =========================================================================
-- 4. Research & Analysis Pack (Builder + Pro)
-- =========================================================================
(
  'research-analysis',
  'Research & Analysis',
  'Deep market research, technical research projects, and PARA knowledge organization.',
  'research',
  'builder',
  '1.0.0',
  'celune',
  'Search',
  ARRAY['research', 'analysis', 'knowledge', 'market', 'technical'],
  true,
  true,
  '[
    {"path": "skills/research/CLAUDE.md", "category": "skill", "tier": "essential", "description": "Deep market and technical research"},
    {"path": "skills/project-research/CLAUDE.md", "category": "skill", "tier": "standard", "description": "Research project lifecycle"},
    {"path": "skills/brain/CLAUDE.md", "category": "skill", "tier": "standard", "description": "PARA knowledge organization and semantic search"}
  ]'::jsonb,
  '{"ai-ml": 1, "content": 1, "other": 1, "web-app": 2, "fullstack": 2, "mobile": 3}'::jsonb
),

-- =========================================================================
-- 5. Autonomous AFK Pack (Pro)
-- =========================================================================
(
  'autonomous-afk',
  'Autonomous AFK',
  'Let your agents work while you''re away: overnight builds, housekeeping, backlog grooming, and blog writing.',
  'workflow',
  'pro',
  '1.0.0',
  'celune',
  'Moon',
  ARRAY['autonomous', 'afk', 'overnight', 'automation', 'background'],
  true,
  true,
  '[
    {"path": "skills/auto-approve/CLAUDE.md", "category": "skill", "tier": "standard", "description": "Autonomous execution mode with guardrails"},
    {"path": "skills/afk-overnight/CLAUDE.md", "category": "skill", "tier": "standard", "description": "Overnight autonomous task runner"},
    {"path": "skills/afk-building/CLAUDE.md", "category": "skill", "tier": "standard", "description": "Autonomous platform feature building"},
    {"path": "skills/afk-housekeeping/CLAUDE.md", "category": "skill", "tier": "standard", "description": "Cleanup task runner"},
    {"path": "skills/afk-planning/CLAUDE.md", "category": "skill", "tier": "standard", "description": "Autonomous backlog grooming"},
    {"path": "skills/afk-blogging/CLAUDE.md", "category": "skill", "tier": "standard", "description": "Overnight blog post creation"}
  ]'::jsonb,
  '{"web-app": 2, "fullstack": 2, "ai-ml": 2, "content": 1, "mobile": 3, "other": 2}'::jsonb
),

-- =========================================================================
-- 6. Quality & Review Pack (Builder + Pro)
-- =========================================================================
(
  'quality-review',
  'Quality & Review',
  'Debugging protocols, TDD enforcement, and code review checklists for high-quality codebases.',
  'workflow',
  'builder',
  '1.0.0',
  'celune',
  'ShieldCheck',
  ARRAY['quality', 'testing', 'tdd', 'review', 'debugging'],
  true,
  true,
  '[
    {"path": "skills/debugging/CLAUDE.md", "category": "skill", "tier": "essential", "description": "4-phase debugging protocol"},
    {"path": "skills/context-management/CLAUDE.md", "category": "skill", "tier": "essential", "description": "Session degradation prevention"},
    {"path": "skills/tdd/CLAUDE.md", "category": "skill", "tier": "standard", "description": "Red-green-refactor enforcement"},
    {"path": "skills/code-review/CLAUDE.md", "category": "skill", "tier": "standard", "description": "Quality checklist with quick and full modes"}
  ]'::jsonb,
  '{"web-app": 1, "fullstack": 1, "mobile": 1, "ai-ml": 2, "content": 3, "other": 2}'::jsonb
),

-- =========================================================================
-- 7. Slack Integration Pack (Pro)
-- =========================================================================
(
  'slack-integration',
  'Slack Integration',
  'Pull Slack context into your agent conversations. Bridges team communication with AI workflows.',
  'integration',
  'pro',
  '1.0.0',
  'celune',
  'MessageSquare',
  ARRAY['slack', 'integration', 'communication', 'team'],
  true,
  true,
  '[
    {"path": "skills/slack/CLAUDE.md", "category": "skill", "tier": "standard", "description": "Pull Slack context before responding"}
  ]'::jsonb,
  '{"web-app": 2, "fullstack": 2, "content": 2, "ai-ml": 3, "mobile": 3, "other": 3}'::jsonb
)

ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  pack_category = EXCLUDED.pack_category,
  min_tier = EXCLUDED.min_tier,
  version = EXCLUDED.version,
  icon = EXCLUDED.icon,
  tags = EXCLUDED.tags,
  is_published = EXCLUDED.is_published,
  skill_entries = EXCLUDED.skill_entries,
  team_type_affinity = EXCLUDED.team_type_affinity;
  $sql$;
END
$seed$;
