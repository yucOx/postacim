import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/test/**/*.test.ts', 'web/src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // each file gets its own process → its own ephemeral server + tmp DB
    pool: 'forks',
    fileParallelism: true,
  },
});
