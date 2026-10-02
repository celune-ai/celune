# Agent Memory System

Persistent key-value memory for AI agents, backed by the `agent_memory` Supabase table.

## Schema

| Column       | Type        | Description                                                               |
| ------------ | ----------- | ------------------------------------------------------------------------- |
| `id`         | UUID        | Primary key                                                               |
| `key`        | TEXT        | Unique identifier (e.g. `voice-tts-error-recovery`)                       |
| `category`   | TEXT        | One of: `preference`, `decision`, `context`, `fact`, `general`, `handoff` |
| `content`    | TEXT        | The memory content (free-form text)                                       |
| `tags`       | TEXT        | Comma-separated tags for search                                           |
| `source`     | TEXT        | Origin (e.g. `claude-code`, `slack-bot`, `web`)                           |
| `version`    | INTEGER     | Auto-incremented on update                                                |
| `expires_at` | TIMESTAMPTZ | Optional expiration                                                       |
| `created_at` | TIMESTAMPTZ | Creation timestamp                                                        |
| `updated_at` | TIMESTAMPTZ | Last update timestamp                                                     |

## Categories

- **preference** — User preferences (e.g. "always use bun", "dark mode preferred")
- **decision** — Architecture or design decisions made during sessions
- **context** — Contextual information about the project state
- **fact** — Stable facts about the codebase or environment
- **general** — Miscellaneous memories
- **handoff** — Session-to-session handoff notes

## API Endpoints

### `GET /api/memory/entries`

List memory entries with optional filters.

Query params: `category`, `source`, `limit`, `offset`

### `GET /api/memory/entries/[key]`

Get a single memory entry by key.

### `GET /api/memory/search`

Search memory entries by content or tags.

### `GET /api/memory/stats`

Get aggregate stats (counts by category, recent entries).

## Query Functions (`@repo/db/queries`)

```typescript
getAgentMemoryEntries(supabase, { category?, source?, limit?, offset? })
getAgentMemoryByKey(supabase, key)
getAgentMemoryByKeys(supabase, keys[])
```

## Storage

Memories are stored via the `/api/memory/entries` API or directly in Supabase.

## Usage Pattern

1. **During sessions:** Store key decisions and facts via the memory API
2. **On session close:** `/closing-time` skill stores important session decisions
3. **On session start:** Query relevant memories to restore context
4. **In dashboard:** View and manage memories via `/memory` page
