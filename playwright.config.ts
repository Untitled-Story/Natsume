import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'packages/natsume/tests/browser',
  use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium' },
  webServer: {
    command: 'pnpm --filter natsume-playground dev --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
});
