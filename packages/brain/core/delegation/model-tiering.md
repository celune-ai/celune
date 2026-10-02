# Model Tiering

Rules for assigning AI models to agent roles based on task complexity and cost efficiency.

## Model Selection

| Tier   | Model  | Use For                                                      |
| ------ | ------ | ------------------------------------------------------------ |
| Tier 1 | Opus   | Lead agent — long sessions, full context, max reasoning      |
| Tier 2 | Sonnet | PM, Designer, Code Reviewer — nuanced work requiring quality |
| Tier 3 | Haiku  | Researcher — bounded tasks, research, formulaic work         |

## Cost Rates (per million tokens)

| Tier   | Model  | Input  | Output | Cache Read | Cache Write |
| ------ | ------ | ------ | ------ | ---------- | ----------- |
| Tier 1 | Opus   | $15.00 | $75.00 | $1.50      | $18.75      |
| Tier 2 | Sonnet | $3.00  | $15.00 | $0.30      | $3.75       |
| Tier 3 | Haiku  | $0.80  | $4.00  | $0.08      | $1.00       |

## Cost-Aware Routing

- Default to the cheapest tier that can handle the task. Research -> Haiku. Code review -> Sonnet. Architecture -> Opus.
- Sonnet is 5x cheaper than Opus on input, 5x on output. Haiku is ~19x cheaper than Opus on input.
- Prompt caching saves ~90% on cached input tokens — structure prompts for cache hits.

## Context Window Optimization

- **Keep prompts tight.** Agent CLAUDE.md specs should be under 200 lines.
- **Prefer Haiku sub-agents for research.** Spawn Haiku agents to gather context, then process in the lead's context.
- **Batch tool calls.** Parallel tool calls reduce round-trips and context usage.
- **Use `model` parameter on Agent tool.** Override: `model: "haiku"` for quick lookups, `model: "opus"` for complex work.
- **Scope tasks narrowly.** A task touching 3 files beats one touching 10.

## Prompt Caching Guidelines

Anthropic's prompt caching caches from the **start of the prompt**. Structure agent prompts so stable content comes first and variable content comes last.

### Stable Prefix Pattern

Order prompt sections from most-stable to most-variable:

```
1. Identity      — who the agent is (never changes)
2. Rules         — guardrails and constraints (rarely changes)
3. Process       — how to execute (changes occasionally)
4. Task content  — specific task details (changes every run)
```

### Guidelines for Cacheable Prompts

- **Do:** Put identity, guardrails, and process steps before task variables.
- **Do:** Keep the variable section clearly delimited (`## Your Task` at the end).
- **Do:** Use consistent wording in stable sections — even minor changes break the cache.
- **Don't:** Interpolate task data into the middle of identity or rules sections.
- **Don't:** Put timestamps, task IDs, or session-specific info anywhere except the variable block.
- **Don't:** Vary system prompt structure between calls.
