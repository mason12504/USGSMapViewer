import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.js', 'tests/fixtures/**/*.test.js', 'tests/server/**/*.test.js'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
