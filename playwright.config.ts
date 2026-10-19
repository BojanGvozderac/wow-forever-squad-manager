import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  globalSetup: "./tests/e2e/setup.ts",
  use: { baseURL: "http://127.0.0.1:3100", screenshot: "only-on-failure" },
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 3100 --strictPort",
    env: { E2E: "1" },
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
