---
metric: composite
direction: higher_is_better
mode: supervised
max_iterations: 20
staleness_threshold_days: 14
time_cap_minutes: 30

constraints:
  - "Never remove or rename existing phases (Phase 0-4)"
  - "Never modify GOAL.md or files in tests/"
  - "Preserve argument format: /build <project URL | UUID | task UUID>"
  - "Never add more than 50 lines in a single iteration"
  - "Never remove orchestration mode selection logic"
  - "Maintain backward compatibility with existing project/task structures"
  - "Never remove closing gate sequence (CR -> DF -> Retro)"

action_catalog:
  - priority: P0
    category: coverage
    description: "Add missing error handling for agent failure mid-sprint"
    impact: high

  - priority: P0
    category: approach
    description: "Improve worktree merge conflict resolution steps"
    impact: high

  - priority: P1
    category: clarity
    description: "Make orchestration mode selection criteria more explicit with examples"
    impact: medium

  - priority: P1
    category: coverage
    description: "Add handling for projects with circular dependencies"
    impact: medium

  - priority: P1
    category: approach
    description: "Improve sprint gate verification steps with specific commands"
    impact: medium

  - priority: P2
    category: structure
    description: "Ensure Phase 2f git branch setup has all edge cases documented"
    impact: medium

  - priority: P2
    category: clarity
    description: "Add concrete examples for sub-agent prompt templates"
    impact: low

  - priority: P3
    category: coverage
    description: "Add guidance for handling partial task completion during context exhaustion"
    impact: low
---

# /build — Fitness Function

Complex orchestration skill (largest in the system). Highest priority for improvement
given its central role in project execution.
