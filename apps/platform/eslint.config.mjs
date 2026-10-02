import { defineConfig } from 'eslint/config';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import baseConfig from '@repo/config/eslint.base.mjs';

export default defineConfig([
  ...baseConfig,
  {
    name: 'project-overrides',
    rules: {
      // Pre-existing issues — downgrade to warnings, fix incrementally
      'react/no-unescaped-entities': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      'prefer-const': 'warn',
      // Ban raw <img> — use next/image for automatic optimization
      // Warn for now (7 pre-existing violations), upgrade to error once fixed
      '@next/next/no-img-element': 'warn',
      // Ban deprecated browser APIs — use modern alternatives
      'no-restricted-properties': [
        'error',
        {
          object: 'navigator',
          property: 'platform',
          message:
            'navigator.platform is deprecated. Use navigator.userAgentData?.platform or parse navigator.userAgent instead.',
        },
      ],
    },
  },
  {
    name: 'jsx-a11y/recommended',
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // Downgrade to warnings — pre-existing issues to fix incrementally
      'jsx-a11y/label-has-associated-control': 'warn',
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-autofocus': 'warn',
      'jsx-a11y/interactive-supports-focus': 'warn',
      'jsx-a11y/no-noninteractive-element-interactions': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',
      'jsx-a11y/no-noninteractive-element-to-interactive-role': 'warn',
    },
  },
]);
