import { defineConfig, globalIgnores } from 'eslint/config';
import baseConfig from '@repo/config/eslint.base.mjs';

export default defineConfig([
  ...baseConfig,
  globalIgnores(['dist/**', 'storybook-static/**']),
  {
    name: 'react-package-overrides',
    rules: {
      '@next/next/no-img-element': 'off',
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
]);
