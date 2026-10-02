import { defineConfig } from 'vitest/config';

// Runs against a booted Supabase stack (see the `isolation` CI job); not part of `pnpm test`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/isolation/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
