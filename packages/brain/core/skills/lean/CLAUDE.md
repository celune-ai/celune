---
name: lean
description: 'Activate lean context mode — minimal vault load, rapid responses.'
user_invocable: true
---

# /lean

Activate lean context mode for this session — minimal vault load, rapid responses.

Use this when you want quick back-and-forth without the full vault dump. Good for rapid Slack-style exchanges, quick lookups, or when context window is getting heavy.

## What Changes in Lean Mode

| Normal mode                         | Lean mode                          |
| ----------------------------------- | ---------------------------------- |
| Loads full CLAUDE.md + session logs | Loads identity + open threads only |
| Pulls inbox, projects, feed digest  | Skips all of that                  |
| Deeper reasoning, longer responses  | Brief answers, 1-3 sentences max   |
| References vault context            | Answers from memory only           |

## How to Execute

1. Acknowledge: `**Lean mode on.** Minimal context — quick answers only. Say /lean off to return to normal.`

2. For the remainder of this session:
   - Respond in 1-3 sentences unless the question genuinely requires more
   - Skip vault lookups, file reads, and FTS searches unless explicitly asked
   - No session log recap, no open thread summaries
   - Answer directly from working memory and CLAUDE.md identity

3. To exit: if the user says `/lean off` or `/normal`, confirm and resume standard mode.

## Notes

- This does not affect your tools — you can still use Bash, Read, etc. if the user asks you to do something specific.
- Lean mode is a communication style shift, not a capability reduction.
- Pairs well with `/personality minimal` for maximum efficiency.
- If you notice context getting heavy (50%+), proactively suggest `/lean` as an option.
