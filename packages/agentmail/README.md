# @repo/agentmail

AgentMail integration for sending branded email reports from Celune agents. Wraps the `agentmail` SDK with Celune-specific formatting and templates.

## Exports

| Export            | File           | Purpose          |
| ----------------- | -------------- | ---------------- |
| `@repo/agentmail` | `src/index.ts` | Main entry point |

## Key Files

| File                 | Purpose                                      |
| -------------------- | -------------------------------------------- |
| `src/index.ts`       | AgentMail client initialization and send API |
| `src/send-report.ts` | Format and send agent activity reports       |
| `src/markdown.ts`    | Markdown-to-HTML conversion for email bodies |
| `src/types.ts`       | Email payload and config types               |

## Dependencies

- `agentmail` (^0.3.9) — AgentMail SDK

## Usage

```ts
import { sendReport } from '@repo/agentmail';

await sendReport({
  to: 'user@example.com',
  subject: 'Agent Activity Report',
  markdown: '## Summary\n\nYour agent completed 5 tasks...',
});
```
