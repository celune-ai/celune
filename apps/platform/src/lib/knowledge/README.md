# Knowledge Connector System

Connects external data sources (Notion, GitHub, Google Drive, etc.) to Celune workspaces via OAuth, crawls content, normalizes to markdown, chunks, embeds with OpenAI, and stores in pgvector for semantic search.

## Architecture

```
User connects source (OAuth via Nango)
  -> nango-client.ts generates OAuth URL
  -> /api/knowledge/oauth/callback stores connection
  -> sync-runner.ts orchestrates crawl
    -> connectors/*.ts fetches raw content
    -> normalize.ts converts to markdown
    -> chunker.ts splits into semantic chunks
    -> embedder.ts generates OpenAI embeddings
    -> ingest.ts stores chunks + vectors in Supabase (pgvector)
  -> onboarding-context.ts surfaces KB in onboarding chat
  -> memory-integration.ts links KB to workspace memory
```

## API Routes

| Method | Path                                      | Purpose                          |
| ------ | ----------------------------------------- | -------------------------------- |
| GET    | `/api/knowledge/oauth/connect/[provider]` | Start OAuth flow for a connector |
| GET    | `/api/knowledge/oauth/callback`           | Handle OAuth callback from Nango |
| GET    | `/api/knowledge/sources`                  | List connected sources           |
| GET    | `/api/knowledge/sources/[id]`             | Get source details               |
| POST   | `/api/knowledge/sources/[id]/sync`        | Trigger manual sync              |
| POST   | `/api/knowledge/search`                   | Semantic search across KB        |
| POST   | `/api/knowledge/upload`                   | Direct file upload               |

## Connector Registry

Defined in `connectors/index.ts`. Each connector implements `SyncFunction`:

```ts
type SyncFunction = (params: ConnectorSyncParams) => Promise<IngestResult>;
```

### Available Connectors

| Connector       | Auth Type | Nango Integration ID | File                            |
| --------------- | --------- | -------------------- | ------------------------------- |
| Notion          | OAuth     | `notion`             | `connectors/notion.ts`          |
| GitHub          | OAuth     | `github`             | `connectors/github.ts`          |
| Google Drive    | OAuth     | `google-drive`       | `connectors/google-drive.ts`    |
| Gmail           | OAuth     | `gmail`              | `connectors/gmail.ts`           |
| Google Calendar | OAuth     | `google-calendar`    | `connectors/google-calendar.ts` |
| Linear          | OAuth     | `linear`             | `connectors/linear.ts`          |
| Asana           | OAuth     | `asana`              | `connectors/asana.ts`           |
| Confluence      | OAuth     | `confluence`         | `connectors/confluence.ts`      |
| Dropbox         | OAuth     | `dropbox`            | `connectors/dropbox.ts`         |
| Figma           | OAuth     | `figma`              | `connectors/figma.ts`           |
| File Upload     | Upload    | n/a                  | `connectors/upload.ts`          |
| URL Crawl       | URL       | n/a                  | `connectors/url-crawl.ts`       |

### Adding a New Connector

1. Create `connectors/my-source.ts` implementing `SyncFunction`
2. Register in `connectors/index.ts` by adding to the `CONNECTORS` map
3. Define `authType` (`oauth` | `upload` | `url`) and `nangoIntegrationId`
4. The sync function receives `{ sourceId, workspaceId, connectionId, options }` and returns `IngestResult`

## Key Modules

| File                    | Purpose                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| `nango-client.ts`       | Nango API client — fetch OAuth tokens, generate connect URLs     |
| `sync-runner.ts`        | Orchestrates sync with status tracking + error recovery          |
| `normalize.ts`          | Convert raw content (HTML, PDF, etc.) to clean markdown          |
| `chunker.ts`            | Split markdown into semantic chunks (heading-aware, ~4000 chars) |
| `embedder.ts`           | Generate OpenAI `text-embedding-3-small` vectors (512 dims)      |
| `ingest.ts`             | Store chunks + embeddings in Supabase pgvector table             |
| `onboarding-context.ts` | Surface KB content during onboarding chat                        |
| `memory-integration.ts` | Link KB documents to workspace memory system                     |

## Sync Runner: Retry & Error Recovery

`sync-runner.ts` provides `withRetry()` — exponential backoff (base 1s, max 30s, 3 retries). The runner:

1. Sets source status to `syncing` in Supabase
2. Calls the connector's sync function with retry wrapper
3. On success: updates status to `synced`, stores chunk count + last sync time
4. On failure: updates status to `error`, stores error message for display

## Onboarding Context Flow

`onboarding-context.ts` queries the KB for relevant chunks when the onboarding chat needs workspace context. This allows the onboarding agent to reference the user's actual documentation during setup conversations.

## API Routes

The canonical API surface is `/api/knowledge/`:

| Route                                     | Methods          | Purpose                       |
| ----------------------------------------- | ---------------- | ----------------------------- |
| `/api/knowledge/sources`                  | GET, POST        | List/create knowledge sources |
| `/api/knowledge/sources/[id]`             | GET, PUT, DELETE | Manage individual source      |
| `/api/knowledge/sources/[id]/sync`        | POST, PUT        | Trigger/run sync              |
| `/api/knowledge/search`                   | POST             | Semantic search across KB     |
| `/api/knowledge/upload`                   | POST             | File upload ingestion         |
| `/api/knowledge/oauth/connect/[provider]` | GET              | Get Nango session token       |

> **Note:** `/api/brain/knowledge-sources` also exists for brain-specific access but `/api/knowledge/sources` is the primary surface. Use `/api/knowledge/` for new code.

## Required Environment Variables

| Variable           | Required | Description                                      |
| ------------------ | -------- | ------------------------------------------------ |
| `NANGO_HOST_URL`   | Yes      | Nango API URL (default: `https://api.nango.dev`) |
| `NANGO_SECRET_KEY` | Yes      | Nango API secret key                             |
| `OPENAI_API_KEY`   | Yes      | OpenAI API key for embeddings                    |
