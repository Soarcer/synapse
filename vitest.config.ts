import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['server/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['server/**/*.ts', 'src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['**/*.test.*', '**/*.d.ts', 'server/index.ts'],
    },
  },
});
