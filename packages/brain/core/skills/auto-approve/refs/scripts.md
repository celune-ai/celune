# Auto-Approve Scripts

## Pre-flight Safety Scan

```bash
cd $CELUNE_REPO

echo "=== Pre-flight Safety Scan ==="

# 1. Current branch
BRANCH=$(git branch --show-current)
echo "Branch: $BRANCH"
if [ "$BRANCH" != "main" ]; then
  echo "WARNING: Not on main — working on feature branch '$BRANCH'"
fi

# 2. Uncommitted changes
DIRTY=$(git status --short | wc -l | tr -d ' ')
echo "Uncommitted changes: $DIRTY files"
if [ "$DIRTY" -gt 0 ]; then
  echo "WARNING: Dirty working tree. Consider committing before going autonomous."
  git status --short
fi

# 3. Unpushed commits
UNPUSHED=$(git log origin/$BRANCH..$BRANCH --oneline 2>/dev/null | wc -l | tr -d ' ')
echo "Unpushed commits: $UNPUSHED"

# 4. Check for .env files in staging area (should never be committed)
STAGED_ENV=$(git diff --cached --name-only | grep -E '\.env' || true)
if [ -n "$STAGED_ENV" ]; then
  echo "CRITICAL: .env file staged for commit — aborting auto-approve!"
  echo "$STAGED_ENV"
  exit 1
fi

# 5. Disk space check (< 1GB free is risky for builds)
FREE_GB=$(df -g / | tail -1 | awk '{print $4}')
echo "Free disk space: ${FREE_GB}GB"
if [ "$FREE_GB" -lt 1 ]; then
  echo "WARNING: Low disk space — builds may fail"
fi

# 6. Check if dev server is running (port conflicts)
DEV_PORTS=$(lsof -ti:3000,3001,3002 2>/dev/null | head -5)
if [ -n "$DEV_PORTS" ]; then
  echo "NOTE: Dev server(s) running on ports 3000/3001/3002"
fi

echo "=== Pre-flight complete ==="
```

## Permission Sync Check

```bash
python3 -c "
import json

with open('~/.claude/settings.json') as f:
    settings = json.load(f)

perms = settings.get('permissions', {})
allow = perms.get('allow', [])
deny = perms.get('deny', [])

# --- Required allow entries ---
REQUIRED_ALLOW = [
    'Bash',
    'Read',
    'Edit',
    'Write',
    'Glob',
    'Grep',
    'WebFetch',
    'WebSearch',
    'Task',
    'ToolSearch',
    'mcp__claude_ai_Slack__*',
    'mcp__pencil',
    'mcp__supabase__*',
]

# --- Deny list (destructive commands) ---
REQUIRED_DENY = [
    'Bash(sudo *)',
    'Bash(shutdown *)',
    'Bash(reboot *)',
    'Bash(diskutil *)',
    'Bash(dscl *)',
    'Bash(networksetup *)',
    'Bash(defaults write *)',
    'Bash(scp *)',
    'Bash(rsync *)',
    'Bash(ssh *)',
]

# Remove any stale granular Bash patterns (they don't work for compound commands)
allow = [p for p in allow if not (p.startswith('Bash(') and p not in REQUIRED_DENY)]

missing_allow = [p for p in REQUIRED_ALLOW if p not in allow]
missing_deny = [p for p in REQUIRED_DENY if p not in deny]

if not missing_allow and not missing_deny:
    print('Permission check PASSED — blanket Bash + deny list in place.')
else:
    if missing_allow:
        print(f'ACTION: Adding {len(missing_allow)} missing allow entries')
        allow.extend(missing_allow)
    if missing_deny:
        print(f'ACTION: Adding {len(missing_deny)} missing deny entries')
        deny.extend(missing_deny)

    settings['permissions']['allow'] = sorted(set(allow))
    settings['permissions']['deny'] = sorted(set(deny))

    with open('~/.claude/settings.json', 'w') as f:
        json.dump(settings, f, indent=2)
        f.write('\n')
    print('settings.json UPDATED.')
"
```

## Activation & Timeout Scripts

```bash
# Activate
touch /tmp/auto_approve_active
date +%s > /tmp/auto_approve_start_time
echo "7200" > /tmp/auto_approve_timeout_secs  # 2 hours default
```

```bash
# Timeout check
START=$(cat /tmp/auto_approve_start_time 2>/dev/null || echo 0)
TIMEOUT=$(cat /tmp/auto_approve_timeout_secs 2>/dev/null || echo 7200)
NOW=$(date +%s)
ELAPSED=$((NOW - START))
if [ "$ELAPSED" -gt "$TIMEOUT" ]; then
  rm -f /tmp/auto_approve_active
  echo "Auto-approve timeout reached ($(($ELAPSED / 3600))h $(($ELAPSED % 3600 / 60))m). Pausing — re-run /auto-approve to reactivate."
fi
```

```bash
# Deactivation
rm -f /tmp/auto_approve_active
```

## Progress Checkpoint Log

**Log file:** `memory/overnight/progress-{YYYY-MM-DD}.md`

After completing each task, append:

```markdown
## {HH:MM} — {task title}

- **Task ID:** {id}
- **Status:** Done / Blocked / Deferred
- **Files changed:** {list of files, max 10}
- **Lines:** +{added} / -{removed}
- **Verification:** type-check {pass/fail}, build {pass/fail}, tests {pass/fail}
- **Key decisions:** {any architectural or design choices made}
- **Issues encountered:** {blockers, workarounds, or "none"}
- **Next up:** {what task is being picked up next}
```

```bash
# After each task completion, append to progress log
PROGRESS_LOG="$CELUNE_REPO/memory/overnight/progress-$(date +%Y-%m-%d).md"
mkdir -p "$(dirname "$PROGRESS_LOG")"

# If file doesn't exist, create with header
if [ ! -f "$PROGRESS_LOG" ]; then
  echo "# Overnight Progress — $(date +%Y-%m-%d)" > "$PROGRESS_LOG"
  echo "" >> "$PROGRESS_LOG"
  echo "Auto-approve mode activated at $(date +%H:%M). Branch: $(git branch --show-current)." >> "$PROGRESS_LOG"
  echo "" >> "$PROGRESS_LOG"
fi

# Append task checkpoint (the agent fills in the content)
cat >> "$PROGRESS_LOG" << 'CHECKPOINT'
## {time} — {title}
...
CHECKPOINT
```

**Summary checkpoint every 3 tasks** or every 2 hours:

```markdown
---
### Checkpoint — {HH:MM}
- Tasks completed this session: {N}
- Tasks remaining: {N}
- Current branch: {branch}
- Uncommitted changes: {N} files
- Total lines changed: +{added} / -{removed}
- Any blockers: {yes/no, list}
---
```
