import { defineConfig } from 'tsup';

// Workspace-only @repo/* packages are not published, so their code is bundled in.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    testing: 'src/testing/index.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  dts: {
    resolve: [/^@repo\//],
    compilerOptions: {
      incremental: false,
      baseUrl: '.',
      paths: {
        '@repo/types': ['../types/src/index.ts'],
        '@repo/types/*': ['../types/src/*'],
        '@repo/ui/components/*': ['../ui/src/components/*'],
        '@repo/ui/*': ['../ui/src/*'],
        '@repo/db/*': ['../db/src/*'],
      },
    },
  },
  noExternal: [/^@repo\//],
  external: [/^@celuneai\//],
  splitting: true,
  sourcemap: true,
  clean: true,
});
