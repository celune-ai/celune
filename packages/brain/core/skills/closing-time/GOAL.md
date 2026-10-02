---
metric: composite
direction: higher_is_better
mode: continuous
max_iterations: 10
staleness_threshold_days: 21
time_cap_minutes: 15

constraints:
  - 'Never remove or reorder steps (Steps 0-12)'
  - 'Never modify GOAL.md or files in tests/'
  - 'Preserve the step numbering scheme'
  - 'Never add more than 30 lines in a single iteration'
  - 'Never remove the secret redaction step (Step 8)'
  - 'Never remove the auto-backup step (Step 9b)'

action_catalog:
  - priority: P0
    category: coverage
    description: 'Add error handling for failed git push during auto-backup'
    impact: high

  - priority: P1
    category: clarity
    description: 'Make session log format instructions more specific'
    impact: medium

  - priority: P1
    category: approach
    description: 'Improve missed task audit to reduce false positives'
    impact: medium

  - priority: P2
    category: structure
    description: 'Verify all 13 steps are present and correctly numbered'
    impact: low

  - priority: P3
    category: coverage
    description: 'Add handling for when ccusage is unavailable'
    impact: low
---

# /closing-time — Fitness Function

End-of-session ritual. Lower complexity, fewer improvement opportunities.
Conservative max_iterations to avoid over-optimization.
