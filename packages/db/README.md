# @repo/db

Supabase client, queries, middleware, and domain-specific modules for the Celune platform. Wraps `@supabase/supabase-js` and `@supabase/ssr` to provide typed database access across both apps.

## Exports

| Export                             | File                             | Purpose                                             |
| ---------------------------------- | -------------------------------- | --------------------------------------------------- |
| `@repo/db/client`                  | `src/client.ts`                  | Browser Supabase client (anon key, cookie-based)    |
| `@repo/db/server`                  | `src/server.ts`                  | Server-side Supabase client (cookie-based SSR)      |
| `@repo/db/service`                 | `src/service.ts`                 | Service-role client (bypasses RLS)                  |
| `@repo/db/middleware`              | `src/middleware.ts`              | Next.js middleware session refresh                  |
| `@repo/db/queries`                 | `src/queries.ts`                 | Shared query helpers (tasks, projects, agents)      |
| `@repo/db/api`                     | `src/api.ts`                     | API route helpers (auth extraction, error handling) |
| `@repo/db/validation`              | `src/validation.ts`              | Zod schemas for request validation                  |
| `@repo/db/feature-flags`           | `src/feature-flags.ts`           | Feature flag evaluation                             |
| `@repo/db/brain-manifest-registry` | `src/brain-manifest-registry.ts` | Brain manifest CRUD                                 |
| `@repo/db/brain-section-parser`    | `src/brain/section-parser.ts`    | Parse brain markdown sections                       |
| `@repo/db/brain-section-diff`      | `src/brain/section-diff.ts`      | Diff brain sections                                 |
| `@repo/db/agent-contract`          | `src/agent-contract.ts`          | Agent contract validation                           |
| `@repo/db/skill-ownership`         | `src/skill-ownership.ts`         | Skill ownership resolution                          |
| `@repo/db/config-drift`            | `src/config-drift.ts`            | Config drift detection                              |
| `@repo/db/team-templates`          | `src/team-templates.ts`          | Team workspace templates                            |
| `@repo/db/starter-memories`        | `src/starter-memories.ts`        | Default memories for new workspaces                 |
| `@repo/db/team-memories`           | `src/team-memories.ts`           | Team-shared memory helpers                          |
| `@repo/db/skill-loader`            | `src/skill-loader.ts`            | Load skills from brain manifest                     |
| `@repo/db/byo-skill-validator`     | `src/byo-skill-validator.ts`     | Validate user-submitted skills                      |
| `@repo/db/credential-resolver`     | `src/credential-resolver.ts`     | Resolve encrypted credentials                       |

## Schema & Migrations

- Full schema: `schema/supabase-schema.sql`
- Migrations: `schema/migrations/*.sql` (date-prefixed, applied via `scripts/migrate.mjs`)

```bash
pnpm --filter @repo/db migrate           # Apply pending migrations
pnpm --filter @repo/db migrate:status    # Show migration status
pnpm --filter @repo/db migrate:dry-run   # Preview without applying
```

## Usage

```ts
// Browser client
import { createClient } from '@repo/db/client';
const supabase = createClient();

// Server component / API route
import { createServerClient } from '@repo/db/server';
const supabase = await createServerClient();

// Service role (admin operations)
import { createServiceClient } from '@repo/db/service';
const supabase = createServiceClient();
```

## Setup

Requires environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (for service client)

## Testing

```bash
pnpm --filter @repo/db test
```
