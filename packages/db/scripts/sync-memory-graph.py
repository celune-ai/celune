#!/usr/bin/env python3
"""
Memory Graph ↔ Vault Sync

Bidirectional sync between Supabase memory_relations and Obsidian [[wikilinks]] in the vault.
- Export: reads memory graph from Supabase, writes [[wikilink]] references into vault .md files
- Import: parses [[wikilinks]] from vault .md files, creates memory_relations in Supabase

Usage:
  python3 sync-memory-graph.py --export       # Supabase → Vault
  python3 sync-memory-graph.py --import       # Vault → Supabase
  python3 sync-memory-graph.py --bidirectional # Both directions
"""

import argparse
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

# --- Config ---
VAULT_ROOT = Path(os.environ.get("VAULT_ROOT", ""))
if not VAULT_ROOT or not VAULT_ROOT.exists():
    print("Error: VAULT_ROOT env var must be set to a valid directory", file=sys.stderr)
    sys.exit(1)
MEMORY_DIR = VAULT_ROOT / "memory"

# Relation type mapping for wikilinks
RELATION_PREFIXES = {
    "supports": "supports",
    "contradicts": "contradicts",
    "supersedes": "supersedes",
    "elaborates": "elaborates",
    "depends_on": "depends on",
    "derived_from": "derived from",
    "context_for": "context for",
}


def load_env():
    """Load Supabase credentials from environment variables."""
    url = os.environ.get("SUPABASE_URL", "") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        print("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set as environment variables", file=sys.stderr)
        sys.exit(1)
    return url, key


def supabase_request(url, key, path, method="GET", data=None):
    """Make a Supabase REST API request."""
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    req_url = f"{url}/rest/v1/{path}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(req_url, data=body, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
        return None


def get_workspace_id(url, key):
    """Get the default workspace ID."""
    workspaces = supabase_request(url, key, "workspaces?select=id&limit=1")
    if workspaces and len(workspaces) > 0:
        return workspaces[0]["id"]
    print("Error: No workspace found", file=sys.stderr)
    sys.exit(1)


def export_to_vault(url, key, workspace_id):
    """Export memory relations as [[wikilinks]] in vault markdown files."""
    print("Exporting memory graph to vault...")

    # Fetch all memories with their relations
    memories = supabase_request(
        url, key,
        f"agent_memory?workspace_id=eq.{workspace_id}&is_archived=eq.false&select=id,key,content,category&order=key.asc"
    )
    if not memories:
        print("No memories found")
        return 0

    relations = supabase_request(
        url, key,
        f"memory_relations?workspace_id=eq.{workspace_id}&related_type=eq.memory&select=memory_id,related_id,relation_type,confidence,is_auto_detected"
    )
    if not relations:
        relations = []

    # Build lookup: memory_id → list of (relation_type, related_key, confidence)
    mem_by_id = {m["id"]: m for m in memories}
    graph = {}
    for rel in relations:
        src = rel["memory_id"]
        tgt = rel["related_id"]
        if src not in graph:
            graph[src] = []
        tgt_mem = mem_by_id.get(tgt)
        if tgt_mem:
            graph[src].append({
                "type": rel["relation_type"],
                "key": tgt_mem["key"],
                "confidence": rel.get("confidence", 1.0),
                "auto": rel.get("is_auto_detected", False),
            })

    # Write graph index file
    graph_dir = MEMORY_DIR / "graph"
    graph_dir.mkdir(parents=True, exist_ok=True)

    index_path = graph_dir / "graph-index.md"
    lines = ["# Memory Knowledge Graph\n\n"]
    lines.append(f"_Auto-generated. {len(memories)} memories, {len(relations)} relations._\n\n")

    exported = 0
    for mem in memories:
        mid = mem["id"]
        mkey = mem["key"]
        category = mem.get("category", "general")
        rels = graph.get(mid, [])

        if not rels:
            continue

        # Write individual memory graph file
        safe_key = re.sub(r'[^\w\-]', '-', mkey)[:60]
        mem_path = graph_dir / f"{safe_key}.md"
        mem_lines = [f"# {mkey}\n\n"]
        mem_lines.append(f"**Category:** {category}\n\n")
        mem_lines.append("## Relations\n\n")

        for r in rels:
            prefix = RELATION_PREFIXES.get(r["type"], r["type"])
            conf = f" ({int(r['confidence'] * 100)}%)" if r["confidence"] < 1.0 else ""
            auto = " (auto)" if r["auto"] else ""
            safe_related = re.sub(r'[^\w\-]', '-', r["key"])[:60]
            mem_lines.append(f"- {prefix}: [[{safe_related}]]{conf}{auto}\n")

        mem_path.write_text("".join(mem_lines))
        exported += 1

        # Add to index
        lines.append(f"- [[{safe_key}]] ({category}) — {len(rels)} relations\n")

    index_path.write_text("".join(lines))
    print(f"Exported {exported} memories with relations to {graph_dir}")
    return exported


def import_from_vault(url, key, workspace_id):
    """Import [[wikilinks]] from vault files as memory_relations."""
    print("Importing vault wikilinks as memory relations...")

    graph_dir = MEMORY_DIR / "graph"
    if not graph_dir.exists():
        print("No graph directory found in vault")
        return 0

    # Fetch all memories for key lookup
    memories = supabase_request(
        url, key,
        f"agent_memory?workspace_id=eq.{workspace_id}&is_archived=eq.false&select=id,key"
    )
    if not memories:
        print("No memories found in Supabase")
        return 0

    key_to_id = {m["key"]: m["id"] for m in memories}
    # Also build reverse: sanitized key → original key
    sanitized_to_key = {}
    for m in memories:
        safe = re.sub(r'[^\w\-]', '-', m["key"])[:60]
        sanitized_to_key[safe] = m["key"]

    imported = 0
    wikilink_pattern = re.compile(r'\[\[([^\]]+)\]\]')

    for md_file in graph_dir.glob("*.md"):
        if md_file.name == "graph-index.md":
            continue

        stem = md_file.stem
        source_key = sanitized_to_key.get(stem)
        if not source_key or source_key not in key_to_id:
            continue

        source_id = key_to_id[source_key]
        content = md_file.read_text()

        for match in wikilink_pattern.finditer(content):
            target_safe = match.group(1)
            target_key = sanitized_to_key.get(target_safe)
            if not target_key or target_key not in key_to_id:
                continue

            target_id = key_to_id[target_key]
            if target_id == source_id:
                continue

            # Determine relation type from context
            line_start = content.rfind('\n', 0, match.start()) + 1
            line = content[line_start:match.start()].lower()
            relation_type = "elaborates"  # default
            for rtype, prefix in RELATION_PREFIXES.items():
                if prefix in line:
                    relation_type = rtype
                    break

            # Upsert relation
            result = supabase_request(url, key, "memory_relations", method="POST", data={
                "memory_id": source_id,
                "related_type": "memory",
                "related_id": target_id,
                "relation_type": relation_type,
                "confidence": 1.0,
                "is_auto_detected": False,
                "detected_by": "vault_import",
                "workspace_id": workspace_id,
            })
            if result:
                imported += 1

    print(f"Imported {imported} relations from vault wikilinks")
    return imported


def main():
    parser = argparse.ArgumentParser(description="Memory Graph ↔ Vault Sync")
    parser.add_argument("--export", action="store_true", help="Export Supabase → Vault")
    parser.add_argument("--import-vault", action="store_true", help="Import Vault → Supabase")
    parser.add_argument("--bidirectional", action="store_true", help="Both directions")
    args = parser.parse_args()

    if not any([args.export, args.import_vault, args.bidirectional]):
        args.export = True  # Default to export

    url, key = load_env()
    workspace_id = get_workspace_id(url, key)

    if args.export or args.bidirectional:
        export_to_vault(url, key, workspace_id)

    if args.import_vault or args.bidirectional:
        import_from_vault(url, key, workspace_id)


if __name__ == "__main__":
    main()
