---
name: slack
description: 'Pull context from Slack channels/threads before responding. Use when Slack context is referenced.'
user_invocable: true
requires:
  mcp: [claude_ai_Slack]
---

# slack

Search Slack for context relevant to the current request. Do all of the following in order.

## 1. Determine what to look for

Based on the current conversation, identify:

- **The core topic** — what is the user asking about or referencing?
- **Any explicit references** — "the thread", "what we discussed", a channel name, a project name, a specific date
- **Time range** — how far back is relevant? Default to the last 7 days unless a specific timeframe is implied

## 2. Search Slack

Use the `mcp__claude_ai_Slack__slack_search_public_and_private` tool to search for relevant messages.

Preferred search strategy:

1. Start with the most specific query (project name, exact phrase, or topic keyword)
2. If results are thin, broaden to related keywords
3. If the user mentioned a specific channel (e.g. "#general", "#dev"), use `in:channel-name` modifier
4. If the context is about a thread, retrieve the full thread with `mcp__claude_ai_Slack__slack_read_thread` once you have the thread timestamp

Useful search modifiers:

- `in:channel-name` — limit to a channel
- `from:<@USERID>` — messages from a specific person
- `before:YYYY-MM-DD` / `after:YYYY-MM-DD` — date filters
- `has:link` / `has:pin` — messages with attachments or pins

Your Slack user ID: set `SLACK_USER_ID` in your environment

## 3. Synthesize and respond

After pulling context:

- Briefly confirm what you found (or didn't find) before diving into the response
- Use the Slack context to directly inform your answer — don't just list the results, actually use them
- If you found a thread that started the conversation, reference the original message explicitly
- If nothing relevant was found, say so and proceed with what you know

## 4. Format

Keep the synthesis short. One sentence on what you found, then answer the question. Don't turn this into a Slack recap unless the user asked for one.
