# Skill Layering Architecture

## Pattern

Each skill has two layers:

1. **Core** (`SKILL.md`) — Always loaded into context when the skill is invoked.
   - Target: <200 lines for large skills, <100 lines for small ones
   - Contains: identity, arguments, high-level workflow steps, critical constraints, phase names
   - Uses `Read refs/<name>.md` directives to tell the agent where to find details

2. **Reference** (`refs/*.md`) — Loaded on-demand via Read tool when executing a specific phase.
   - Contains: detailed code blocks, SQL templates, Python scripts, step-by-step procedures
   - Each ref file covers one phase or one concern

## How It Works

When a skill is invoked, only SKILL.md enters context. The core file describes WHAT to do at each phase. When the agent reaches a phase that needs detailed instructions, it reads the specific ref file.

Example flow for /build:
```
1. SKILL.md loads (~200 lines) — agent sees all phases
2. Agent enters Phase 0 — reads refs/phase-0-input-parsing.md
3. Agent enters Phase 1 — reads refs/phase-1-validation.md
4. Agent enters Phase 2 — reads refs/phase-2-orchestration.md
5. etc.
```

The agent does NOT preload all ref files. It reads each one just-in-time.

## Naming Convention

```
skills/<name>/
  SKILL.md              # Core — always loaded
  refs/
    phase-0-*.md        # Phase-specific reference
    phase-1-*.md
    templates.md        # Shared templates (SQL, markdown, prompts)
    supabase-setup.md   # Shared Supabase connection boilerplate
```

## Shared References

Common boilerplate across multiple skills lives in a shared location:

```
skills/_shared/
  supabase-connect.md   # Python snippet for reading env + setting headers
  task-lifecycle.md     # Claim → execute → complete pattern
  git-workflow.md       # Branch creation, commit, push patterns
```

Skills reference these via: `Read ~/.claude/skills/_shared/supabase-connect.md`

## Migration Strategy

1. Start with the largest skills (/build, /project)
2. Identify code blocks >20 lines → move to refs/
3. Replace with a one-line reference: `**Details:** Read refs/phase-N-name.md`
4. Test that the skill still works end-to-end
5. Move to next skill

## Success Criteria

- /build: 1,233 → <200 lines core
- /project: 848 → <150 lines core
- Other 300+ line skills: <150 lines core each
- Total skill text in typical session (8 skills): <1,200 lines (from ~3,700)
