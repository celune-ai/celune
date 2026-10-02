# @repo/types

Shared TypeScript type definitions used across the Celune platform. Zero runtime dependencies.

## Exports

| Export                 | File              | Purpose                                     |
| ---------------------- | ----------------- | ------------------------------------------- |
| `@repo/types`          | `src/index.ts`    | Barrel export of all types                  |
| `@repo/types/task`     | `src/task.ts`     | Task status, priority, and lifecycle types  |
| `@repo/types/project`  | `src/project.ts`  | Project types, phases, and gate definitions |
| `@repo/types/activity` | `src/activity.ts` | Activity feed event types                   |
| `@repo/types/agent`    | `src/agent.ts`    | Agent config, model tier, persona types     |
| `@repo/types/health`   | `src/health.ts`   | Health check and heartbeat types            |

## Additional Type Modules

Located in `src/` but exported through the barrel (`src/index.ts`):

- `usage.ts` — Usage tracking and billing types
- `workspace.ts` — Workspace and team types
- `attachment.ts` — File attachment types
- `voice.ts` / `voice-provider.ts` — Voice and TTS types
- `brain.ts` — Brain manifest types
- `integration.ts` — Third-party integration types
- `agent-contract.ts` — Agent contract definitions
- `dot-voter.ts` — Dot voting types
- `feature-flag.ts` — Feature flag types
- `memory.ts` — Memory and knowledge types
- `permission.ts` — Permission and access types
- `roles.ts` — Role definitions
- `api-key.ts` — API key types
- `billing.ts` — Billing and plan types
- `execution.ts` — Task execution types
- `activity-feed.ts` — Activity feed types

## Usage

```ts
import type { Task, TaskStatus } from '@repo/types/task';
import type { Project } from '@repo/types/project';
import type { Agent } from '@repo/types';
```
