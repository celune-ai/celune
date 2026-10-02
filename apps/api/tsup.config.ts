import { defineConfig } from 'tsup';

// One self-contained file so `node dist/server.js` runs on Node 20, which cannot load the
// workspace packages' TypeScript sources.
export default defineConfig({
  entry: { server: 'src/server.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  noExternal: [/.*/],
  // Bundled CommonJS dependencies call require(); ESM output has no require by default.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  sourcemap: true,
  clean: true,
});
