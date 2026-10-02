import path from 'node:path';
import { defineConfig, mergeConfig } from 'vitest/config';
import sharedConfig from '@repo/config/vitest.shared';

export default mergeConfig(
  sharedConfig,
  defineConfig({
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    test: {
      environment: 'jsdom',
      passWithNoTests: false,
      setupFiles: ['./src/test-setup.ts'],
    },
  }),
);
