# @repo/config

Shared build and lint configuration for all packages in the Celune monorepo.

## Exports

| Export                              | File                   | Purpose                               |
| ----------------------------------- | ---------------------- | ------------------------------------- |
| `@repo/config/vitest.shared`        | `vitest.shared.ts`     | Shared Vitest configuration           |
| `@repo/config/tsconfig.base.json`   | `tsconfig.base.json`   | Base TypeScript config (all packages) |
| `@repo/config/tsconfig.nextjs.json` | `tsconfig.nextjs.json` | TypeScript config for Next.js apps    |
| `@repo/config/eslint.base.mjs`      | `eslint.base.mjs`      | Shared ESLint flat config             |

## Usage

### TypeScript

```json
// packages/*/tsconfig.json
{
  "extends": "@repo/config/tsconfig.base.json"
}

// apps/*/tsconfig.json
{
  "extends": "@repo/config/tsconfig.nextjs.json"
}
```

### ESLint

```js
// packages/*/eslint.config.mjs
import baseConfig from '@repo/config/eslint.base.mjs';
export default [...baseConfig];
```

### Vitest

```ts
// packages/*/vitest.config.ts
import { defineConfig } from 'vitest/config';
import shared from '@repo/config/vitest.shared';
export default defineConfig(shared);
```
