// The scaffold's legacy import resolver does not understand this package export.
// TypeScript and Vite resolve and validate it during typecheck and test startup.
// eslint-disable-next-line import/no-unresolved
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.{ts,tsx}'], environment: 'node' },
});
