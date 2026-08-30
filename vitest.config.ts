import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'development',
      GITHUB_TOKEN: '',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://switchlane:switchlane@localhost:5434/switchlane',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
    },
  },
});