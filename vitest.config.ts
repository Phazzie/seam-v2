import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    environment: 'node',
    testTimeout: 30_000,
    // A test file removes its throwaway apps (each a copy of dist/) when it ends; on Windows, under a full run's load, that
    // took longer than the default 10 s for five files at once (HookTimeoutError in afterAll), and passed alone.
    hookTimeout: 90_000,
  },
});
