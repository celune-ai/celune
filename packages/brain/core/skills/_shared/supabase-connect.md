# Supabase Connection Boilerplate

Use this Python snippet to connect to Supabase in any skill that needs direct API access.

```python
import json, urllib.request, os, datetime, subprocess

# Discover .env.local from repo root (works regardless of user home directory)
_repo_root = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()
env_file = os.path.join(_repo_root, "apps", "platform", ".env.local")
if not os.path.exists(env_file):
    env_file = os.path.join(_repo_root, "apps", "admin", ".env.local")
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

## Resolve Workspace & User

```python
_ws_path = os.path.expanduser("~/.claude/state/active-workspace.json")
WORKSPACE_ID = WORKSPACE_NAME = None
if os.path.exists(_ws_path):
    with open(_ws_path) as _f:
        _ws_data = json.load(_f)
        WORKSPACE_ID = _ws_data.get("workspace_id")
        WORKSPACE_NAME = _ws_data.get("workspace_name")
if not WORKSPACE_ID:
    _req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/workspaces?select=id,name&limit=1",
        headers={**headers, "Prefer": ""},
    )
    _resp = urllib.request.urlopen(_req, timeout=10)
    _ws = json.loads(_resp.read().decode())[0]
    WORKSPACE_ID = _ws["id"]
    WORKSPACE_NAME = _ws["name"]

# Resolve USER_ID from workspace → org → owner
_req = urllib.request.Request(
    f"{SUPABASE_URL}/rest/v1/workspaces?id=eq.{WORKSPACE_ID}&select=org_id",
    headers={**headers, "Prefer": ""},
)
_resp = urllib.request.urlopen(_req, timeout=10)
_org_id = json.loads(_resp.read().decode())[0]["org_id"]

_req = urllib.request.Request(
    f"{SUPABASE_URL}/rest/v1/organizations?id=eq.{_org_id}&select=owner_id",
    headers={**headers, "Prefer": ""},
)
_resp = urllib.request.urlopen(_req, timeout=10)
USER_ID = json.loads(_resp.read().decode())[0]["owner_id"]
```
