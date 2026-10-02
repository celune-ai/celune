# Deployment Guide

Deploy your own instance of the Celune web app. For a local or Docker self-host, start with the root `SETUP.md`.

## Prerequisites

- **Node.js** >= 20
- **pnpm** >= 10
- **Supabase** project (free tier works)
- **Railway** account (or any Docker-capable hosting)
- **GitHub App** (optional, for repo integration)

## 1. Clone and Install

```bash
git clone https://github.com/celune-ai/celune.git
cd celune
pnpm install
```

## 2. Supabase Setup

1. Create a project at [supabase.com](https://supabase.com)
2. Run the base schema migration:
   ```bash
   # Apply schema from packages/db/schema/supabase-schema.sql
   # via Supabase Dashboard > SQL Editor, or using the Supabase CLI:
   supabase db push
   ```
3. Apply migrations in order from `packages/db/schema/migrations/`
4. Enable Row Level Security (RLS) on all tables — the migrations handle this
5. Note your project URL and keys from Settings > API

### Required Supabase Tables

The schema creates these core tables: `workspaces`, `workspace_memberships`, `org_memberships`, `user_roles`, `tasks`, `projects`, `project_groups`, `agent_configs`, `agent_status`, `activity_log`, `agent_memory`, `subscriptions`, `api_keys`, `cron_jobs`.

## 3. Environment Variables

Create `apps/platform/.env.local` with the following:

### Required

| Variable                        | Description                                  | Where to find                                     |
| ------------------------------- | -------------------------------------------- | ------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL                         | Supabase Dashboard > Settings > API               |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous (public) key              | Supabase Dashboard > Settings > API               |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase service role key (server-side only) | Supabase Dashboard > Settings > API               |
| `ALLOWED_ORIGINS`               | Comma-separated allowed origins for CSRF     | Your domain(s), e.g. `https://app.yourdomain.com` |
| `CORS_ORIGINS`                  | Comma-separated CORS origins                 | Same as ALLOWED_ORIGINS                           |

### Branding / Domains

| Variable                       | Description                         | Default           |
| ------------------------------ | ----------------------------------- | ----------------- |
| `NEXT_PUBLIC_APP_DOMAIN`       | Admin app domain                    | `app.celune.ai`   |
| `NEXT_PUBLIC_MARKETING_DOMAIN` | Marketing site domain               | `celune.ai`       |
| `NEXT_PUBLIC_DOCS_DOMAIN`      | Docs site domain                    | `docs.celune.ai`  |
| `NEXT_PUBLIC_SUPPORT_EMAIL`    | Support email displayed in UI       | `hello@celune.ai` |
| `NEXT_PUBLIC_SALES_EMAIL`      | Enterprise contact shown in billing | `hello@celune.ai` |

### Edition

| Variable         | Description                                                  | Required                     |
| ---------------- | ------------------------------------------------------------ | ---------------------------- |
| `CELUNE_EDITION` | `cloud` or `community`; selects the plan and suspension gate | Yes, `cloud` on Celune Cloud |

Set `CELUNE_EDITION=cloud` on every Celune Cloud environment, including previews and staging. The server logs the resolved edition and gate mode once at startup. When it is unset, the edition is inferred from `STRIPE_SECRET_KEY` and the app domain, and an environment without either runs with no suspension, trial, or plan checks.

### Billing (Stripe)

| Variable                                                                                | Description                                              | Required             |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------- |
| `STRIPE_SECRET_KEY`                                                                     | Stripe secret key                                        | For billing features |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`                                                    | Stripe publishable key                                   | For billing features |
| `STRIPE_WEBHOOK_SECRET`                                                                 | Stripe webhook signing secret                            | For billing features |
| `STRIPE_PRICE_CLOUD_MONTHLY`                                                            | Per-seat monthly Celune Cloud price ID                   | For billing features |
| `STRIPE_PRICE_CLOUD_ANNUAL`                                                             | Per-seat annual Celune Cloud price ID                    | For billing features |
| `STRIPE_PRICE_PRO`, `STRIPE_PRICE_TEAM`, `STRIPE_PRICE_UNLIMITED`, `STRIPE_PRICE_BUILD` | Legacy price IDs; subscriptions on them resolve to Cloud | Optional             |

### GitHub Integration (Optional)

| Variable                    | Description                                           |
| --------------------------- | ----------------------------------------------------- |
| `GITHUB_APP_ID`             | GitHub App ID                                         |
| `GITHUB_APP_CLIENT_ID`      | GitHub App OAuth client ID                            |
| `GITHUB_APP_CLIENT_SECRET`  | GitHub App OAuth client secret                        |
| `GITHUB_APP_PRIVATE_KEY`    | GitHub App private key (PEM format, newlines as `\n`) |
| `GITHUB_APP_WEBHOOK_SECRET` | GitHub App webhook secret                             |
| `GITHUB_APP_INSTALL_URL`    | GitHub App installation URL                           |

### Voice / TTS (Optional)

| Variable             | Description                           |
| -------------------- | ------------------------------------- |
| `ELEVENLABS_API_KEY` | ElevenLabs API key for text-to-speech |

### Monitoring (Optional)

| Variable                 | Description                       |
| ------------------------ | --------------------------------- |
| `SENTRY_AUTH_TOKEN`      | Sentry auth token for source maps |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN for error tracking     |
| `SENTRY_ORG`             | Sentry organization slug          |
| `SENTRY_PROJECT`         | Sentry project slug               |

### Other Optional

| Variable            | Description                                 |
| ------------------- | ------------------------------------------- |
| `OPENAI_API_KEY`    | OpenAI key (Whisper transcription fallback) |
| `AGENTMAIL_API_KEY` | AgentMail API key for email notifications   |

## 4. Local Development

```bash
# Run the web app
pnpm dev

# Type-check
pnpm type-check

# Run tests
pnpm test
```

The web app runs on `http://localhost:3002`.

## 5. Vercel Deployment

### Build Settings

| Setting          | Value                                      |
| ---------------- | ------------------------------------------ |
| Framework        | Next.js                                    |
| Root Directory   | `apps/platform`                            |
| Build Command    | `cd ../.. && pnpm build --filter=platform` |
| Output Directory | `.next`                                    |
| Install Command  | `pnpm install`                             |

### Steps

1. Import the repository in Vercel
2. Set the root directory to `apps/platform`
3. Add all required environment variables from section 3
4. Deploy

### Custom Domain

1. Add your domain in Vercel > Settings > Domains
2. Update `ALLOWED_ORIGINS` and `CORS_ORIGINS` with the new domain
3. Update `NEXT_PUBLIC_APP_DOMAIN` to match

## 6. GitHub App Setup (Optional)

To enable repository integration:

1. Go to GitHub > Settings > Developer settings > GitHub Apps > New GitHub App
2. Configure:
   - **Homepage URL**: `https://your-app-domain.com`
   - **Callback URL**: `https://your-app-domain.com/api/github/callback`
   - **Webhook URL**: `https://your-app-domain.com/api/github/webhooks`
   - **Webhook secret**: Generate a random string
3. Permissions needed:
   - Repository: Contents (Read & Write), Pull requests (Read & Write), Issues (Read)
   - Organization: Members (Read)
4. Generate a private key and download it
5. Set the env vars: `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_INSTALL_URL`

## 7. First User Setup

1. Create an account via Supabase Auth (email/password or OAuth)
2. In Supabase SQL Editor, set the first user as platform owner:
   ```sql
   UPDATE auth.users
   SET raw_user_meta_data = raw_user_meta_data || '{"is_platform_owner": true}'::jsonb
   WHERE email = 'your-email@example.com';
   ```
3. Create an organization and default workspace:

   ```sql
   INSERT INTO organizations (id, name) VALUES (gen_random_uuid(), 'My Org');

   -- Use the org ID from above
   INSERT INTO workspaces (name, slug, org_id, is_default)
   VALUES ('Main', 'main', '<org-id>', true);
   ```

4. The onboarding wizard will guide you through the remaining setup

## 8. Upgrades, Migrations, and Rollback

### Before you upgrade

Run the same checks CI runs, from the repo root:

```bash
pnpm type-check
pnpm test
pnpm build
```

### Apply new migrations

Migrations live in `packages/db/schema/migrations/` and are recorded in `public._migrations`, so each one runs once. Check what is pending, then apply:

```bash
pnpm migrate --status      # history and pending files
pnpm migrate --dry-run     # pending files, nothing applied
pnpm migrate               # apply pending files, with a prompt
```

Apply migrations before you deploy code that depends on them. See [How the schema is applied](../../SETUP.md#how-the-schema-is-applied) for how a fresh database boots.

### Health check

`GET /api/health` returns `200` with a JSON body whose `status` is `"ok"` when the app is up. It needs no auth. Point your host's health check at this path; `/` redirects signed-out visitors, so it is not a reliable health check.

### Roll back

1. Find the commit that caused the problem: `git log --oneline -10`.
2. Revert it in a new commit: `git revert <sha>`. Do not force-push to `main`.
3. Redeploy the reverted commit.

Migrations only move forward. If the change you are rolling back included a migration, write a new migration that reverses it instead of deleting rows from `public._migrations`.

### Monitoring

- Your host's deploy logs and the `/api/health` check show whether the app is running.
- The Supabase dashboard shows database health, RLS policies, and function logs.
- The in-app activity feed (`/activity`) shows agent events.

## Troubleshooting

### "Authentication required" on all API routes

- Verify `SUPABASE_SERVICE_ROLE_KEY` is set correctly
- Check that the Supabase URL matches your project

### GitHub App not working

- Ensure the private key PEM has `\n` for newlines (not literal newlines)
- Verify the callback URL matches your deployment domain exactly
- Check webhook delivery in GitHub App settings > Advanced

### CORS errors

- Add your domain to both `ALLOWED_ORIGINS` and `CORS_ORIGINS`
- Include both `https://` and `https://www.` variants if applicable

### Build failures

- Run `pnpm install` from the repo root (not from `apps/platform`)
- Ensure Node.js >= 20 is installed
- Check that `pnpm` version is >= 10
