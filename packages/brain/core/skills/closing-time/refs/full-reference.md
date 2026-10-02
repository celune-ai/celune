# /closing-time — Full Reference

Complete original SKILL.md preserved for reference. Core SKILL.md has lean step summaries.

---

## Step 6b: Brain Self-Evolution (COG Pattern)

If the session produced key decisions, learnings, or patterns worth sharing across all workspaces, write them to the brain manifest.

**When to write:**

- New architecture decisions that affect how agents work
- New patterns or conventions discovered during implementation
- Security findings or best practices worth codifying
- Process improvements that should persist across sessions

**How to write:**

```python
import json, urllib.request, hashlib, datetime

env_file = "$CELUNE_REPO/apps/admin/.env.local"
SUPABASE_URL = SUPABASE_KEY = ""
with open(env_file) as f:
    for line in f:
        if line.startswith("NEXT_PUBLIC_SUPABASE_URL="): SUPABASE_URL = line.split("=",1)[1].strip()
        elif line.startswith("SUPABASE_SERVICE_ROLE_KEY="): SUPABASE_KEY = line.split("=",1)[1].strip()

headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json", "Prefer": "return=representation"}

import os
ws_path = os.path.expanduser("~/.claude/state/active-workspace.json")
ws_id = json.load(open(ws_path))["workspace_id"] if os.path.exists(ws_path) else None

if ws_id:
    content = "## Session Learning: {title}\n\n{content}"
    content_hash = hashlib.sha256(content.encode()).hexdigest()[:16]

    entry = {
        "workspace_id": ws_id,
        "path": f"session-learnings/{datetime.date.today().isoformat()}-{slug}",
        "category": "session-learning",
        "tier": "essential",
        "is_core": False,
        "content_hash": content_hash,
        "version": "1.0.0",
        "metadata": {"source": "closing-time", "session_date": datetime.date.today().isoformat()}
    }

    req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/brain_manifest", data=json.dumps(entry).encode(), headers=headers, method="POST")
    urllib.request.urlopen(req, timeout=10)
```

**Rules:**

- Only write genuinely new information — check existing entries before creating duplicates
- Use category `session-learning` to distinguish from seeded content
- Set `is_core: false` — session learnings are workspace-specific, not core system items
- Skip if no meaningful learnings this session

---

## Step 9b: Auto-Backup Repos

**Vault:**

```bash
if [ -d "$VAULT_ROOT/.git" ]; then
  cd "$VAULT_ROOT"
  git add -A
  git diff --cached --quiet || git commit -m "auto-backup: session $(date +%Y-%m-%d-%H%M)"
  git push origin main 2>/dev/null || echo "Vault push failed — check remote"
fi
```

**celune-platform (if uncommitted changes):**

```bash
cd $CELUNE_REPO
git add -A
git diff --cached --quiet || git commit -m "auto-backup: session $(date +%Y-%m-%d-%H%M)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
  git push origin "$BRANCH" 2>/dev/null || echo "celune-platform push failed"
fi
```

Do NOT push to main. Only push if on a feature branch.

---

## Step 9c: Email Session Summary (opt-in)

If `AGENTMAIL_API_KEY` is set and email was requested (or this is an overnight AFK session):

```bash
cd $CELUNE_REPO
node -e "
import('@repo/agentmail').then(({ sendAgentReport }) => {
  return sendAgentReport({
    from: 'rick',
    subject: 'Session Summary — $(date +%Y-%m-%d)',
    markdown: \`# Session Summary\n\n## What shipped\n{bullet list}\n\n## Key decisions\n{list}\n\n## Open threads\n{list}\`
  });
}).then(r => console.log(r.ok ? 'Email sent: ' + r.messageId : 'Email failed: ' + r.error));
"
```

Skip if the API key is not set or the session was very short.
