---
name: deploy
description: "Deploy to production via the user's connected deployment provider. Auto-detects Railway, Vercel, Cloudflare Pages, Netlify, or Fly.io from environment and MCP tools."
user_invocable: true
requires:
  bins: [git, gh]
---

# /deploy — Provider-Agnostic Deploy

Deploys the current branch to production by detecting the user's active deployment provider and routing to the appropriate workflow. Does NOT hardcode any specific provider — works with whatever the user has connected.

## Arguments

`/deploy [--service <name>] [--env <environment>] [--skip-checks]`

- `/deploy` — deploy current branch to production (auto-detect provider + service)
- `/deploy --service admin` — deploy a specific service
- `/deploy --env staging` — deploy to a specific environment
- `/deploy --skip-checks` — skip pre-deploy verification (type-check, tests)

---

## On Invocation

### Step 1: Detect deployment provider

Check for provider signals in this order:

1. **MCP tools available** — check for `mcp__railway__*`, `mcp__vercel__*`, `mcp__cloudflare__*` tools
2. **CLI tools installed** — check for `railway`, `vercel`, `flyctl`, `netlify`, `wrangler` in PATH
3. **Environment variables** — check for `RAILWAY_PROJECT_ID`, `VERCEL_PROJECT_ID`, `CLOUDFLARE_ACCOUNT_ID`, `FLY_APP`
4. **Config files** — check for `railway.json`, `vercel.json`, `wrangler.toml`, `fly.toml`, `netlify.toml`

If multiple providers detected, ask the user which one to use.

If **no provider detected**, respond with:

> No deployment provider connected. To deploy, connect one of these:
>
> | Provider | How to connect |
> | -------------------- | ------------------------------------------------------------------------------------ | ------------------------ |
> | **Railway** | Install CLI: `npm i -g @railway/cli && railway login`, or add the Railway MCP server |
> | **Vercel** | Install CLI: `npm i -g vercel && vercel login` |
> | **Cloudflare Pages** | Install CLI: `npm i -g wrangler && wrangler login` |
> | **Netlify** | Install CLI: `npm i -g netlify-cli && netlify login` |
> | **Fly.io** | Install CLI: `curl -L https://fly.io/install.sh                                      | sh && flyctl auth login` |
>
> After connecting, run `/deploy` again.

Then **stop** — do not proceed to Step 2.

### Step 2: Pre-deploy verification (unless --skip-checks)

```bash
# Ensure we're on the deploy branch (usually main)
BRANCH=$(git branch --show-current)

# Check for uncommitted changes
git status --short

# Run type-check
pnpm type-check

# Run tests
pnpm test
```

If type-check or tests fail, **stop** and report the failures. Do not deploy broken code.

If there are uncommitted changes, ask the user if they want to commit before deploying.

### Step 3: Deploy via detected provider

#### Railway (MCP or CLI)

**If Railway MCP tools are available:**

```
Use mcp__railway__deploy tool
Use mcp__railway__get-logs to monitor
Use mcp__railway__list-deployments to verify
```

**If Railway CLI is available:**

```bash
railway up --detach
railway logs --latest
```

#### Vercel (CLI)

```bash
npx vercel --prod
```

#### Cloudflare Pages (CLI)

```bash
npx wrangler pages deploy dist/
```

#### Netlify (CLI)

```bash
npx netlify deploy --prod
```

#### Fly.io (CLI)

```bash
flyctl deploy
```

### Step 4: Verify deployment

After deploy completes:

1. **Get the deployment URL** from provider output
2. **Health check** — curl the deployment URL (or /api/health if available)
3. **Report status**:
   - Deployment URL
   - Build duration (if available)
   - Health check result

```
Deployed to production via {provider}.
  URL: {deployment-url}
  Status: {healthy|unhealthy}
  Duration: {time}
```

### Step 5: Rollback guidance

If health check fails:

```
⚠ Health check failed on {url}.
  To rollback:
  - Railway: `railway rollback` or redeploy previous commit via dashboard
  - Vercel: `npx vercel rollback`
  - Fly.io: `flyctl releases rollback`
  - Cloudflare/Netlify: redeploy previous commit via dashboard
```

---

## Guard Rails

- **NEVER** deploy without running checks first (unless `--skip-checks`)
- **NEVER** deploy from a dirty working tree without user confirmation
- If the provider requires a specific branch (e.g., main), ensure you're on it or that git-push deploy triggers are configured
- For git-push-triggered deploys (Railway, Vercel), the deploy happens automatically on push — just confirm the deployment started and monitor logs
- This skill is provider-agnostic and must NOT hardcode provider-specific logic. All provider routing happens through detection in Step 1.
