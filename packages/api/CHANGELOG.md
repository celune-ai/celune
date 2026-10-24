# @celuneai/api

## 0.2.0

### Minor Changes

- 64f0314: Unexpected errors now answer 500 with `{ error: 'internal_error', request_id }` and an `x-request-id` header, in place of `{ error: 'Internal server error' }`; the log line carries the same request id. `POST /v1/agents/heartbeat` now validates `event_type` against the known event types and answers 400 for any other value.

### Patch Changes

- 64f0314: API key auth no longer rejects a valid key when another key shares its stored prefix. `ApiKeyLookup.findByPrefix` may return every row for the prefix, and the key is matched on its hash. A lookup that throws now answers 503 with `Retry-After` instead of 401, so an outage is not reported as an invalid key.
- 64f0314: Update `@modelcontextprotocol/sdk` to 1.31.0.
- Updated dependencies [64f0314]
  - @celuneai/core@0.2.0
