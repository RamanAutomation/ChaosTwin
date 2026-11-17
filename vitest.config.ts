import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@chaostwin/contracts': path.join(root, 'packages/contracts/src/index.ts'),
      '@chaostwin/core': path.join(root, 'packages/core/src/index.ts'),
      '@chaostwin/android-adapter': path.join(root, 'packages/android-adapter/src/index.ts'),
      '@chaostwin/evidence': path.join(root, 'packages/evidence/src/index.ts'),
      '@chaostwin/fault-engine': path.join(root, 'packages/fault-engine/src/index.ts'),
      '@chaostwin/reporter': path.join(root, 'packages/reporter/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
