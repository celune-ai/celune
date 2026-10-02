---
'@celuneai/api': patch
---

API key auth no longer rejects a valid key when another key shares its stored prefix. `ApiKeyLookup.findByPrefix` may return every row for the prefix, and the key is matched on its hash. A lookup that throws now answers 503 with `Retry-After` instead of 401, so an outage is not reported as an invalid key.
