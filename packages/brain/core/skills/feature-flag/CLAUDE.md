---
name: feature-flag
description:
  "Register, toggle, list, and manage feature flags from Claude Code. Auto-creates flags in Supabase via admin API.
  TRIGGER when: user says '/feature-flag', 'create a flag', 'toggle flag', 'list flags', or references feature flag management during development.
  DO NOT TRIGGER when: building the feature flags system itself, or general flag discussions."
user_invocable: true
---

# /feature-flag — Manage Feature Flags

Create, toggle, list, and inspect feature flags directly from Claude Code.

## Arguments

- `/feature-flag create <name>` — Create a new boolean flag (auto-generates key from name)
- `/feature-flag toggle <key>` — Toggle a flag's enabled/disabled state
- `/feature-flag list` — Show all flags with status
- `/feature-flag status <key>` — Show single flag detail
- `/feature-flag delete <key>` — Delete a flag (with confirmation)

## Connection

```python
import json, urllib.request

env_file = "$CELUNE_REPO/apps/admin/.env.local"
SUPABASE_URL = SUPABASE_KEY = ""
with open(env_file) as f:
    for line in f:
        if line.startswith("NEXT_PUBLIC_SUPABASE_URL="):
            SUPABASE_URL = line.split("=", 1)[1].strip()
        elif line.startswith("SUPABASE_SERVICE_ROLE_KEY="):
            SUPABASE_KEY = line.split("=", 1)[1].strip()

headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}
```

## Commands

### create

```python
name = "<flag name>"
key = name.lower().replace(" ", "-").replace("_", "-")
# Remove non-alphanumeric except hyphens
import re
key = re.sub(r'[^a-z0-9-]', '', key).strip('-')

flag = {
    "key": key,
    "name": name,
    "flag_type": "boolean",
    "enabled": False,
    "tags": [],
}

req = urllib.request.Request(
    f"{SUPABASE_URL}/rest/v1/feature_flags",
    data=json.dumps(flag).encode(),
    headers=headers,
    method="POST"
)
resp = urllib.request.urlopen(req, timeout=10)
result = json.loads(resp.read().decode())
created = result[0] if isinstance(result, list) else result
```

After creating, output the usage snippet:

```typescript
import { isFeatureEnabled } from '@repo/db/feature-flags';

const enabled = await isFeatureEnabled('<key>', {
  userId: session.user.id,
  email: session.user.email,
  plan: workspace.plan,
});

if (enabled) {
  // Feature code here
}
```

### toggle

```python
# First fetch by key
req = urllib.request.Request(
    f"{SUPABASE_URL}/rest/v1/feature_flags?key=eq.{key}&select=id,key,name,enabled",
    headers={**headers, "Prefer": ""},
)
resp = urllib.request.urlopen(req, timeout=10)
flags = json.loads(resp.read().decode())
flag = flags[0]

# Toggle
new_enabled = not flag["enabled"]
req = urllib.request.Request(
    f"{SUPABASE_URL}/rest/v1/feature_flags?id=eq.{flag['id']}",
    data=json.dumps({"enabled": new_enabled}).encode(),
    headers=headers,
    method="PATCH"
)
urllib.request.urlopen(req, timeout=10)
```

### list

```python
req = urllib.request.Request(
    f"{SUPABASE_URL}/rest/v1/feature_flags?select=key,name,enabled,flag_type,tags,updated_at&order=created_at.desc",
    headers={**headers, "Prefer": ""},
)
resp = urllib.request.urlopen(req, timeout=10)
flags = json.loads(resp.read().decode())
```

Present as table: `| Status | Key | Name | Type | Tags |`

### status

Fetch single flag by key with full details including rules and audit log.

### delete

Fetch by key, confirm with user via AskUserQuestion, then DELETE.
