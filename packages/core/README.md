# @celuneai/core

Celune's domain services for tasks, projects, jobs, agents, comments, and attachments. Services depend on two interfaces:

- **Store**: persistence. `@celuneai/core/supabase` provides a Supabase implementation; `@celuneai/core/testing` provides an in-memory one for tests.
- **Gate**: plan and suspension checks. `NoopGate` allows everything, which is what a self-hosted community edition uses.

```bash
npm install @celuneai/core @supabase/supabase-js
```

```ts
import { createClient } from '@supabase/supabase-js';
import { createServices } from '@celuneai/core';
import { SupabaseAttachmentBlobs, SupabaseStore } from '@celuneai/core/supabase';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const services = createServices(new SupabaseStore(supabase), {
  attachmentBlobs: new SupabaseAttachmentBlobs(supabase),
});
// services.tasks, services.projects, services.jobs, services.agents, services.attachments
```

`createServices` uses `NoopGate` unless you pass `gate`. The service surface can change before 1.0.

| Entry point               | Contents                                       |
| ------------------------- | ---------------------------------------------- |
| `@celuneai/core`          | Services, errors, scopes, Store and Gate types |
| `@celuneai/core/config`   | Host and edition configuration                 |
| `@celuneai/core/supabase` | Supabase Store and attachment blob storage     |
| `@celuneai/core/testing`  | In-memory Store for tests                      |

Requires Node.js 20 or later. Part of [Celune](https://github.com/celune-ai/celune).

## License

Apache-2.0
