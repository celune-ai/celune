---
name: afk-learning
description: 'Autonomous skill improvement using the Karpathy autoresearch loop. Reads a skill, builds eval rubric, runs improvement iterations, produces before/after scorecard.'
user_invocable: true
requires:
  bins: [node]
---

# /afk-learning — Autonomous Skill Improvement

Applies the Karpathy autoresearch loop to any skill: read it, define what "good" means, iterate autonomously, report what improved.

## Arguments

`/afk-learning <skill-name>` — improve a specific skill
`/afk-learning <skill-name> --focus "<area>"` — focus on a specific weakness (e.g. `--focus "closing gates get skipped"`)
`/afk-learning <skill-name> --iterations N` — number of improvement cycles (default: 5)

---

## Prerequisites Check

Before running, verify the skill is in the optimization sweet spot:

- **60-80% quality** → autoresearch will find failure patterns. Proceed.
- **Below 60%** → needs a rewrite, not optimization. Tell the user.
- **Above 90%** → diminishing returns. Warn the user but proceed if they insist.
- **Must know what "good" looks like** — if you can't define quality criteria, that's the work to do first.

---

## Phase 1: Setup (Two Human Touchpoints)

### Step 1: Skill Inventory (automatic)

Read the entire skill directory:

```bash
SKILL_DIR="$HOME/.claude/skills/<skill-name>"
ls -la "$SKILL_DIR/"
ls -la "$SKILL_DIR/refs/" 2>/dev/null
```

Document:

- **What the skill does** (1-2 sentences from description)
- **Inputs**: What triggers it, what arguments it takes
- **Outputs**: What it produces (code, files, tasks, API calls, etc.)
- **Editable files**: SKILL.md + any ref files (these are what we'll modify)
- **Fixed files**: Anything outside the skill directory (shared configs, CLAUDE.md)
- **Known failure modes**: Check memory for feedback entries about this skill
- **Recent usage**: Search session logs or memory for when this skill was last used and what went wrong

### Step 2: Build Eval Rubric (automatic, then human review)

Generate 6-10 scoring dimensions based on the skill's purpose. Each dimension is 1-5.

**Example for /build:**

| Dimension              | 1 (Fail)            | 3 (Acceptable)         | 5 (Excellent)               |
| ---------------------- | ------------------- | ---------------------- | --------------------------- |
| Quality Gates executed | Skipped entirely    | Ran but incomplete     | All 3 ran with findings     |
| CI/QG disambiguation   | Confused, conflated | Mentioned but unclear  | Clearly separate concepts   |
| Task sync              | No Supabase sync    | Partial sync           | All tasks claimed/completed |
| PR completeness        | Missing sections    | Has sections, gaps     | All sections with data      |
| Follow-up tasks        | None created        | Listed but not created | Created in Supabase         |
| Error handling         | Silent failures     | Some error paths       | All paths covered           |

**Then convert to binary pass/fail** for the autonomous loop (1-5 is too fuzzy for unsupervised scoring):

- "Did Quality Gates execute before Phase 4?" → YES/NO
- "Are CI Checks and Quality Gates named differently in all sections?" → YES/NO
- "Does Phase 4 have an explicit entry gate?" → YES/NO

**Touchpoint 1**: Present rubric to user. Ask: "Does this capture what 'good' means for this skill? Any dimensions to add/remove?"

### Step 3: Generate Test Scenarios (automatic, then human review)

Create 5-10 diverse test scenarios that exercise the skill's edge cases:

**Example for /build:**

1. Small project (3 tasks, solo mode) — does it still run Quality Gates?
2. Large project (15 tasks, sub-agents) — does it compact and maintain context?
3. Research project — does it use Retro + Deliverable instead of CR/DF/Retro?
4. Single-task mode — does it skip Phase 1 but still run some quality check?
5. Project with no UI changes — does it auto-skip DF correctly?
6. After compaction — does the skill recover and know where it left off?
7. Momentum scenario — 3 sprints done, tests pass, does it still run Quality Gates?

For each scenario, define:

- **Input**: How the skill would be triggered
- **Expected output**: What a correct execution looks like
- **Pass criteria**: Binary — did it do the right thing?

**Touchpoint 2**: Present scenarios to user. Ask: "Do these cover the failure modes you've seen? Any scenarios to add?"

---

## Phase 2: Autonomous Loop

After user approves rubric + scenarios, the loop runs unsupervised.

### Per Iteration:

1. **Analyze**: Read current SKILL.md + refs. Identify the weakest dimension from the rubric (lowest-scoring or most frequently failing binary check).

2. **Hypothesize**: Propose ONE specific change to address the weakness. Changes should be:
   - Targeted (one section, one concept)
   - Reversible (save the original before editing)
   - Testable (the binary eval can detect the improvement)

3. **Edit**: Apply the change to SKILL.md or ref file. Save a backup:

   ```bash
   cp "$SKILL_DIR/SKILL.md" "$SKILL_DIR/.autoresearch/backup_iteration_N.md"
   ```

4. **Evaluate**: Run ALL binary evals against the modified skill text. This is a static analysis — read the skill as an LLM would and check:
   - Does the text unambiguously pass each binary criterion?
   - Could a fresh agent (no prior context) misinterpret the instructions?
   - Are there sections where the old terminology/pattern could leak through?
   - Simulate: "If I were executing this skill right now, would I skip Quality Gates?"

5. **Score**: Tally pass/fail across all binary evals. Compare to previous iteration.

6. **Keep or Discard**:
   - Score improved or held steady → KEEP the change
   - Score regressed on ANY dimension → DISCARD (restore backup)
   - If discarded, log why and try a different approach next iteration

7. **Log**: Write to `$SKILL_DIR/.autoresearch/iteration_N.md`:

   ```markdown
   ## Iteration N

   - Target: <weakest dimension>
   - Hypothesis: <what we're trying>
   - Change: <file + section modified>
   - Result: KEEP / DISCARD
   - Score: X/Y binary evals passing (was X'/Y)
   - Notes: <what we learned>
   ```

### Loop Controls

- Default: 5 iterations
- Stop early if: all binary evals pass for 2 consecutive iterations
- Max: 20 iterations (diminishing returns beyond this)

### What CAN Be Changed

- SKILL.md text, structure, ordering, emphasis
- Ref file text (phase-\*.md, full-reference.md)
- Section headers, terminology, warnings, gates
- Add new sections, checklists, failure mode warnings

### What CANNOT Be Changed

- Skill frontmatter (name, description, user_invocable)
- External files (CLAUDE.md, other skills, package code)
- The fundamental purpose of the skill
- Remove functionality — only improve/clarify existing

---

## Phase 3: Debrief

### Step 1: Before/After Scorecard

```markdown
## Autoresearch Results: /skill-name

**Iterations**: N run, M kept, (N-M) discarded
**Duration**: ~Xm

### Rubric Scores (1-5)

| Dimension               | Before | After | Delta |
| ----------------------- | ------ | ----- | ----- |
| Quality Gates execution | 2      | 5     | +3    |
| CI/QG disambiguation    | 1      | 5     | +4    |
| ...                     | ...    | ...   | ...   |

### Binary Evals

| Check                             | Before | After |
| --------------------------------- | ------ | ----- |
| Quality Gates run before Phase 4? | FAIL   | PASS  |
| CI and QG use different terms?    | FAIL   | PASS  |
| Phase 4 has explicit entry gate?  | FAIL   | PASS  |
| ...                               | ...    | ...   |

### Changes Kept

1. Iteration 2: Renamed "Sprint 99: Closing Gates" → "Sprint 99: Quality Gates"
2. Iteration 3: Added Phase 4 entry gate with 3 yes/no questions
3. ...

### Changes Discarded

1. Iteration 4: Tried adding auto-skip for DF — regressed PR completeness score

### Remaining Weaknesses

- <dimensions still below 4/5>
- <binary evals still failing>
```

### Step 2: Consistency Sweep

After all iterations, do a final pass across ALL files in the skill directory:

- Grep for old terminology that should have been replaced
- Verify cross-references between SKILL.md and ref files are consistent
- Check that examples in ref files match the updated SKILL.md patterns

### Step 3: Present to User

Show the scorecard. Ask:

- "These changes are applied. Want to review the diff?"
- "Any remaining weaknesses you want me to target in another round?"

---

## Edge Cases

| Case                                    | Action                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| Skill directory doesn't exist           | Error: "Skill not found. Available skills: ..."                               |
| No ref files                            | Only optimize SKILL.md                                                        |
| User provides --focus                   | Weight that dimension 3x in scoring                                           |
| All evals pass on first check           | Report "Skill is already at 90%+" and suggest only targeted improvements      |
| Iteration makes things worse repeatedly | After 3 consecutive discards, stop and report "May need a structural rewrite" |

## AFK Mode

This skill is designed for autonomous execution. When chained from `/closing-time`:

1. Skip Touchpoint 1 (use auto-generated rubric)
2. Skip Touchpoint 2 (use auto-generated scenarios)
3. Run the full loop
4. Write results to `~/.claude/state/afk-learning-results.md`
5. Present scorecard on next session start

---

## Conventions

- Never modify files outside the skill directory
- Always create backups before editing
- Log every iteration — the log IS the value, not just the final state
- Binary evals > rubric scores for autonomous decisions
- One change per iteration — never batch multiple changes
- The loop optimizes for clarity and unambiguity, not brevity
