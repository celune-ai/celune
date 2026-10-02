---
metric: composite
direction: higher_is_better
mode: continuous
max_iterations: 15
staleness_threshold_days: 21
time_cap_minutes: 20

constraints:
  - 'Never remove or rename existing sections'
  - 'Never modify GOAL.md or files in tests/'
  - 'Preserve argument format and trigger conditions'
  - 'Never add more than 30 lines in a single iteration'
  - 'Maintain task description format (What/Value/Approach/Sequence/Blockers)'

action_catalog:
  - priority: P0
    category: coverage
    description: 'Add handling for tasks that span multiple workspaces'
    impact: high

  - priority: P1
    category: clarity
    description: 'Make priority mapping criteria more specific with examples'
    impact: medium

  - priority: P1
    category: approach
    description: 'Improve pod-aware assignee selection with domain keywords'
    impact: medium

  - priority: P2
    category: structure
    description: 'Verify task description template sections are complete'
    impact: low

  - priority: P2
    category: coverage
    description: 'Add edge case for tasks with missing workspace_id'
    impact: medium

  - priority: P3
    category: clarity
    description: 'Add examples of good vs bad task titles'
    impact: low
---

# /task — Fitness Function

Medium-complexity skill for creating individual Supabase inbox tasks.
