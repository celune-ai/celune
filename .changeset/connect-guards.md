---
'@celuneai/cli': patch
---

`celune connect --check` sends the key saved by `celune setup` only to its own origin and needs https except on localhost; `connect --write` refuses symlinked targets, and `--name` must be a plain name.
