import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'fixtures/**', 'experiments/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: [
      'packages/contracts/**/*.ts',
      'packages/android-adapter/**/*.ts',
      'packages/fault-engine/**/*.ts',
      'packages/reporter/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:child_process', 'node:fs', 'node:fs/promises', 'child_process', 'fs'],
              message:
                'Keep process and filesystem access in @chaostwin/core. Adapters and contracts receive injected ports.',
            },
          ],
        },
      ],
    },
  },
);
