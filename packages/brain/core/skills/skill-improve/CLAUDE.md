---
name: skill-improve
description: "Run bounded improvement iterations on a skill using its GOAL.md fitness function.\n  TRIGGER when: the user says '/skill-improve', 'improve this skill', 'optimize skill', or wants to run the self-improvement loop on a specific skill.\n  DO NOT TRIGGER when: creating new skills, editing skills manually, or general code review."
user_invocable: true
---

# /skill-improve — Bounded Skill Improvement Loop

Run the AutoResearch-inspired Modify → Verify → Keep/Revert cycle on a skill. Each iteration makes ONE atomic change, measures the score, and keeps or reverts.

## Arguments

`/skill-improve <skill-name> [--iterations N] [--dry-run]`

Examples:

- `/skill-improve closing-time` — improve /closing-time with defaults from its GOAL.md
- `/skill-improve build --iterations 5` — run 5 improvement iterations on /build
- `/skill-improve task --dry-run` — show the action catalog and score without making changes

---

## Step 0: Resolve Skill

```bash
SKILL_DIR="packages/brain/core/skills/<skill-name>"
FRAMEWORK_DIR="packages/brain/core/skills/_framework"
```

Verify the skill exists, has a CLAUDE.md or SKILL.md, and has a GOAL.md. If GOAL.md is missing, auto-generate one:

```bash
$FRAMEWORK_DIR/generate-harness.sh $SKILL_DIR
```

---

## Step 1: Read GOAL.md and Current State

Parse the skill's GOAL.md for:

- **mode**: `converge` (stop at target), `continuous` (keep improving), `supervised` (ask before each change)
- **max_iterations**: hard cap on iterations
- **time_cap_minutes**: wall clock limit
- **constraints**: list of things agents MUST NOT change
- **action_catalog**: prioritized list of improvement actions

Read the current skill file and `improvements.jsonl` to understand:

- What changes have been made before
- Which actions have been tried
- Current score trajectory

---

## Step 2: Get Baseline Score

```bash
BASELINE=$($FRAMEWORK_DIR/test-runner.sh $SKILL_DIR)
```

Report the baseline:

```
Skill: <name>
Baseline score: <score>/100
  Structure: <n>/100 (40% weight)
  Clarity: <n>/100 (35% weight)
  Completeness: <n>/100 (25% weight)
```

If `--dry-run`, show the action catalog sorted by priority and stop.

---

## Step 3: Improvement Loop

For each iteration (up to max_iterations or time_cap):

### 3a. Select Next Action

Pick the highest-priority action from the catalog that respects **category rotation**:

- No 3+ consecutive iterations from the same category
- Categories: `structure`, `clarity`, `coverage`, `approach`
- If rotation blocks all high-priority actions, relax to allow any category

Read `improvements.jsonl` to check what categories were used in the last 2 iterations.

### 3b. Read Constraints

Before making any change, re-read the constraints list. Verify the planned change doesn't violate any constraint. Common constraints:

- "Never remove or rename existing sections"
- "Never modify GOAL.md or files in tests/"
- "Preserve the skill's argument format and trigger conditions"
- "Never add more than 50 lines in a single iteration"

### 3c. Make ONE Atomic Change

Apply the selected action to the skill file. Rules:

- **One change per iteration.** Never batch multiple improvements.
- Changes must be small and focused (typically 5-30 lines added/modified).
- Use the Edit tool, not Write (preserve existing content).
- Do NOT modify GOAL.md, test-runner.sh, metric scripts, or anything in tests/.

Examples of atomic changes:

- Add an edge case handling section
- Replace a vague instruction with a concrete file path and command
- Add error recovery steps after a step that can fail
- Add a code block example for a complex instruction
- Fix heading hierarchy (H2 before H3)
- Add a numbered step list where instructions were paragraph-form

### 3d. Git Commit Before Verification

Commit the change BEFORE running verification. This enables clean revert if needed.

```bash
git add $SKILL_DIR/
git commit -m "skill-improve($SKILL_NAME): iteration $N — $ACTION_DESCRIPTION

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

### 3e. Run Test Harness

```bash
RESULT=$($FRAMEWORK_DIR/test-runner.sh $SKILL_DIR)
NEW_SCORE=$(echo $RESULT | python3 -c "import sys,json; print(json.load(sys.stdin)['score'])")
```

### 3f. Keep or Revert

**If score improved or stayed the same:** KEEP the change.

```
✓ Iteration $N: $OLD_SCORE → $NEW_SCORE (+$DELTA)
  Action: [$PRIORITY] ($CATEGORY) $DESCRIPTION
```

**If score decreased:** REVERT the change.

```bash
git revert HEAD --no-edit
```

```
✗ Iteration $N: $OLD_SCORE → $NEW_SCORE ($DELTA) — REVERTED
  Action: [$PRIORITY] ($CATEGORY) $DESCRIPTION
```

### 3g. Log Result

Append to `improvements.jsonl`:

```json
{
  "iteration": 1,
  "action_priority": "P0",
  "category": "coverage",
  "action": "Add missing edge case handling for common failure modes",
  "score_before": 55.0,
  "score_after": 58.5,
  "delta": 3.5,
  "result": "kept",
  "timestamp": "2026-03-18T21:30:00Z"
}
```

### 3h. Check Stop Conditions

Stop if:

- `max_iterations` reached
- `time_cap_minutes` exceeded
- **Mode = converge** and `target_score` reached
- **Mode = supervised** — ask user before next iteration
- 3 consecutive reverts (stuck — improvement options exhausted for now)
- Action catalog exhausted (all actions tried)

---

## Step 4: Update Baseline

If the final score is higher than the stored baseline, update it:

```bash
$FRAMEWORK_DIR/test-runner.sh $SKILL_DIR > $SKILL_DIR/tests/baseline.json
```

---

## Step 5: Summary Report

```
## Skill Improvement Report: /<skill-name>

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Composite | 55.0 | 67.5 | +12.5 |
| Structure | 75 | 80 | +5 |
| Clarity | 0 | 35 | +35 |
| Completeness | 100 | 100 | 0 |

| Iteration | Action | Category | Score | Result |
|-----------|--------|----------|-------|--------|
| 1 | Add edge case handling | coverage | 55→58 | ✓ Kept |
| 2 | Replace vague instructions | clarity | 58→62 | ✓ Kept |
| 3 | Add error recovery steps | coverage | 62→60 | ✗ Reverted |
| 4 | Add code block examples | clarity | 62→67.5 | ✓ Kept |

Kept: 3 | Reverted: 1 | Skipped: 0
Time: 8 minutes
```

---

## Anti-Gaming Protections

These are enforced by the framework (LOCKED scripts) and this skill file:

1. **Dual-gate verification**: Score must improve AND no constraint violations. The agent cannot modify the scoring criteria (metric scripts are LOCKED).

2. **Category rotation**: No 3+ consecutive iterations from the same category. Prevents over-optimizing one dimension at the expense of others.

3. **Constraint linting**: Before each change, verify against the constraints list in GOAL.md. The constraints themselves are in the LOCKED frontmatter.

4. **Progressive deception detection**: If a single metric dimension increases by >25 points in one iteration, flag for human review. Large jumps often indicate gaming (e.g., adding keywords that trigger metric checks without adding real value).

5. **Session cap**: `max_iterations` and `time_cap_minutes` prevent infinite loops. Default: 10 iterations, 15 minutes.

6. **Git-diff gate**: After each change, verify the diff is ≤50 lines added. Massive changes in a single iteration are a smell.

7. **Human oversight trigger**: After 5 consecutive iterations without improvement (all reverted), stop and surface for human review.

---

## Integration Points

- **`/afk-housekeeping`**: Runs `/skill-improve` on stale skills (staleness_threshold_days exceeded)
- **`/closing-time`**: Reports skill improvement metrics in session summary
- **`/brain-publish`**: Runs test harness as quality gate before publishing skill updates
- **`/project`**: Auto-generates GOAL.md + harness when creating new skills

---

## Constraints (for this skill itself)

- Never modify LOCKED files (\_framework/_, \_templates/_)
- Never modify GOAL.md files directly (generate-harness.sh creates them)
- Never skip the git commit before verification step
- Always revert on score regression — no exceptions
- Never make more than one change per iteration
