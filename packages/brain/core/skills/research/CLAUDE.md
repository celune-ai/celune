---
name: research
description: 'Deep market research producing a structured document. Scales from quick scan to overnight deep dive.'
user_invocable: true
---

# /research — Deep Research & Research Project Execution

Two modes:

1. **Topic mode**: `/research <topic>` — standalone research, outputs a document
2. **Execute mode**: `/research <project-uuid>` — runs a research project's tasks through to deliverable

## Arguments

`/research <topic, URL, area of interest, OR project UUID> [depth]`

**Input types:** topic, YouTube URL, web URL, codebase area, or a project UUID.

---

## Mode Detection

Parse the argument:

- **UUID pattern** (8-4-4-4-12 hex, or 8+ hex prefix) → **Execute mode** — run the research project
- **Everything else** → **Topic mode** — standalone research

---

## Execute Mode — Run a Research Project

When given a project UUID, execute all tasks in the research project through to the deliverable.

### Step 0: Load Project

**Read `~/.claude/skills/_shared/supabase-connect.md` for connection boilerplate.**

1. Fetch the project by UUID from Supabase
2. Verify `project_type = 'research'` — if not, error: "This is a {type} project. Use `/build {id}` instead."
3. Fetch all tasks for the project, ordered by sprint

### Step 1: Execute Sprint 1 (Parallel Research)

For each Sprint 1 task:

1. Set task to `in_progress`
2. Launch a sub-agent (scaled by task assignee):
   - RICK tasks → Explore agent (codebase audit, technical feasibility)
   - DELV tasks → general-purpose agent (web research, competitive analysis)
   - NOIR tasks → general-purpose agent (UX patterns, design research)
   - SAGE tasks → general-purpose agent (content synthesis, strategy)
3. Agent does the research: web searches, code exploration, YouTube transcripts
4. Agent writes findings to a research document section
5. Set task to `done` with outcome summarizing key findings

Launch Sprint 1 tasks in parallel where possible (use `run_in_background`).

### Step 2: Execute Sprint 2 (Synthesis)

After all Sprint 1 tasks complete:

1. Set synthesis task to `in_progress`
2. Gather all Sprint 1 task outcomes
3. SAGE synthesizes into the target deliverable format (PRD, RFC, Strategy Brief, etc.)
4. Write the full document to `.claude/research/<project-slug>.md`
5. Set task to `done`

### Step 3: Execute Closing Tasks

Sequential:

1. **Retro** — gather all findings, identify research gaps, create action items as tasks
2. **Research Deliverable** — finalize document, save to vault, report summary

### Step 4: Report

Present:

- Executive summary (3-5 bullet points)
- Deliverable file path
- Key findings with confidence levels
- Recommended next steps (create `/project-plan`? Build immediately?)
- Link to project in Celune

---

## Topic Mode — Standalone Research

Quick research that outputs a document without creating a Supabase project.

**Depth levels:**

| Depth        | Trigger Phrases            | Agents | Sources                                 | Time        |
| ------------ | -------------------------- | ------ | --------------------------------------- | ----------- |
| `quick`      | "quick look", "brief scan" | 1-2    | 5-10 searches                           | ~5 min      |
| `standard`   | Default                    | 3-4    | 15-25 searches + 1-2 videos             | ~15-30 min  |
| `deep`       | "deep dive", "thorough"    | 4-5    | 30-50 searches + 3-5 videos + forums    | ~1-2 hours  |
| `exhaustive` | "all night", "overnight"   | 5+     | 50-100+ searches, videos, forums, blogs | Hours (AFK) |

### Step 0: Determine Depth

Parse the user's message for effort cues. Map to depth level.

### Step 1: Scope & Frame

Define 3-7 research questions (What problem? Who are users? What exists? Pain points? Patterns? Revenue? Gap?). Quick=top 3, exhaustive=every angle.

### Step 2: Multi-Source Research

**Load MCP tools first:** `ToolSearch: "tavily"`. For deep+, also `ToolSearch: "firecrawl"`.

Launch parallel agents scaled to depth:

| Agent            | Role                                   | Min Depth |
| ---------------- | -------------------------------------- | --------- |
| Market Analyst   | Market size, trends, revenue models    | quick     |
| Competitor Scout | Competitors, pricing, features, gaps   | quick     |
| User Researcher  | Pain points, complaints, unmet needs   | standard  |
| Pattern Hunter   | UI/UX patterns, best-in-class examples | standard  |
| Content Scanner  | YouTube, blogs, thought leaders        | deep      |

**Read refs/tools.md for MCP tool details, YouTube transcript commands, and usage recipes.**

### Step 3: Synthesis

Merge findings. Resolve contradictions. Highlight surprises. Note confidence levels. Quick=Executive Summary + Competitors + Use Cases. Exhaustive=all sections fully populated.

### Step 4: Output

Save to: `$VAULT_ROOT/04-projects/research-<topic-slug>.md`

**Read refs/templates.md for the full output template.**

Report: file location, executive summary, top 3 findings, go/no-go, recommended next step.

---

## Conventions

- Depth scales everything — agents, sources, completeness, time
- Always cite sources — every claim traces to a URL or video
- Opinionated output — make recommendations, not just lists
- Vault location: always `04-projects/research-<slug>.md` (topic mode) or `.claude/research/<slug>.md` (execute mode)
- Topic mode feeds into `/project-plan` — reference in PRD's Research & Discovery section
- Execute mode feeds into `/build` — the deliverable informs the next project
- `/project-research` creates research projects. `/research` executes them.
