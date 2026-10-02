---
'@celuneai/api': minor
---

Unexpected errors now answer 500 with `{ error: 'internal_error', request_id }` and an `x-request-id` header, in place of `{ error: 'Internal server error' }`; the log line carries the same request id. `POST /v1/agents/heartbeat` now validates `event_type` against the known event types and answers 400 for any other value.
