import { defineConfig } from 'tsup';

// Workspace-only @repo/* packages are not published, so their code is bundled in.
// The CSS build runs separately (see the build script in package.json).
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    tasks: 'src/tasks/index.ts',
    projects: 'src/projects/index.ts',
    hooks: 'src/hooks/index.ts',
    utils: 'src/utils/index.ts',
    testing: 'src/testing/index.tsx',
  },
  format: ['esm'],
  target: 'es2022',
  platform: 'browser',
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
  splitting: true,
  sourcemap: true,
  clean: false,
  // Every entry renders or wraps client components; esbuild drops per-file directives when bundling.
  banner: { js: "'use client';" },
});
