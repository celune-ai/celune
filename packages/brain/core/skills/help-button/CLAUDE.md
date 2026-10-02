---
name: help-button
description: Add a contextual HelpButton that opens the support chat with a specific prompt
user_invocable: true
trigger: /help-button
arguments: <location description> — <what the help should explain>
---

# /help-button — Add Contextual Help Button

Add a `HelpButton` component to a UI element that opens the support chat with a pre-loaded contextual prompt.

## Component

`/apps/platform/src/components/help-button.tsx`

```tsx
import { HelpButton } from '@/components/help-button';

<HelpButton prompt="Your contextual help prompt here." />;
```

### Props

| Prop        | Type           | Default  | Description                                   |
| ----------- | -------------- | -------- | --------------------------------------------- |
| `prompt`    | `string`       | required | The message sent to support chat when clicked |
| `size`      | `'sm' \| 'md'` | `'sm'`   | Icon button size                              |
| `className` | `string`       | `''`     | Additional CSS classes                        |

## How It Works

1. User clicks the `?` icon button
2. `useSupportChat().openWithPrompt(prompt)` is called
3. Support chat panel opens, starts a new conversation
4. The prompt is auto-sent as the first user message
5. The AI agent streams a contextual response

## Requirements

- Component must be rendered inside `SupportChatProvider` (already wraps the entire app in `admin-layout.tsx`)
- The `prompt` should be written as if the user is asking the question — it becomes the first chat message

## Workflow

1. User provides: **where** to add the button and **what** it should help with
2. Add `import { HelpButton } from '@/components/help-button';` to the target file
3. Place `<HelpButton prompt="..." />` in the appropriate location
4. Write the prompt as a natural user question that gives the AI enough context to provide a helpful, step-by-step answer

## Prompt Writing Guidelines

- Write in first person as the user: "I need help with..." / "How do I..."
- Include specific context about what UI element they're looking at
- Mention the platform/service if it's about external integrations
- Ask for step-by-step instructions when appropriate
- Keep prompts under 200 words

## Examples

```tsx
// Next to a provider key input
<HelpButton prompt="I need help getting an Anthropic API key. Walk me through the steps." />

// Next to a GitHub connect button
<HelpButton prompt="How do I connect my GitHub account? What permissions does this require?" />

// Next to a billing section
<HelpButton prompt="Explain the pricing tiers and what's included in each plan." />

// Next to a complex settings toggle
<HelpButton prompt="What does the 'agent autonomy' setting do? When should I enable or disable it?" />
```
