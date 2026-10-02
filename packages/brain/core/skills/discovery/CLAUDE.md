---
name: discovery
description: 'Explore before you build. Research 2-3 implementation approaches via DELV agent before committing to one.'
user_invocable: true
---

# /discovery — Explore Before You Implement

Lightweight research before implementation. Spawns a research agent to investigate approaches so you pick the right path upfront.

## Arguments

`/discovery <task description | question | topic>`

---

## Step 1: Frame the Exploration

Parse the input and determine scope:

- **Task ID** → fetch task from Supabase, extract the problem statement
- **Question** → use as-is ("How should we implement X?")
- **Topic** → frame as "What are the best approaches to implement {topic}?"

Define the exploration prompt:

```
Research {problem statement}. Find 2-3 viable implementation approaches.
For each approach, analyze: feasibility, effort, pros, cons, risks.
Look at existing code patterns, external libraries, and architectural options.
```

## Step 2: Spawn DELV Agent

Use Explore subagent (Haiku tier — fast and cheap):

```
Agent(
  subagent_type="Explore",
  prompt="Very thorough exploration of {codebase_path} for: {exploration_prompt}

  Return a structured comparison of approaches:
  1. What exists in the codebase already (patterns, utilities, similar features)
  2. 2-3 viable approaches with:
     - Approach name
     - How it works (1-2 sentences)
     - Files to modify
     - Estimated effort (S/M/L)
     - Pros
     - Cons
     - Risks
  3. Your recommended approach and why"
)
```

## Step 3: Synthesize Results

Format the agent's findings into a decision card:

```markdown
## Discovery: {topic}

### Existing Patterns

{What the codebase already has that's relevant}

### Approaches

#### 1. {Approach A} — {effort}

{How it works}

- **Pros:** {list}
- **Cons:** {list}
- **Files:** {file paths}

#### 2. {Approach B} — {effort}

{How it works}

- **Pros:** {list}
- **Cons:** {list}
- **Files:** {file paths}

#### 3. {Approach C} — {effort} (if applicable)

{How it works}

- **Pros:** {list}
- **Cons:** {list}
- **Files:** {file paths}

### Recommendation

**Go with {Approach X}** because {reason}.
{Trade-off acknowledgment — what you're giving up}
```

## Step 4: Present and Act

Show the comparison card to the user. Wait for their choice:

- **"go with 1"** / **"approach A"** → set as the implementation plan
- **"go with recommendation"** → use the recommended approach
- **"none, let me think"** → save findings to memory for later
- **"dig deeper on 2"** → spawn another Explore agent focused on that approach

If the user picks an approach:

1. Save the discovery findings to memory (for future reference)
2. If a task ID was provided, update the task's `## Approach` section with the chosen approach
3. Optionally feed into `/plan` for a full implementation spec

## Integration with /build

When `/build` encounters an XL-effort task, it may suggest:

> This is an XL task. Run `/discovery` first? (y/n, default: n)

Non-blocking suggestion — default is no.

## Conventions

- Keep explorations focused — 2-3 approaches max (decision paralysis at 4+)
- Always include effort estimates so the user can factor in time
- The "Existing Patterns" section prevents reinventing the wheel
- If only 1 viable approach exists, say so — don't fabricate alternatives
- Exploration results are ephemeral unless saved to memory
- Use Explore agent (Haiku) for cost efficiency — this is research, not implementation
