import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import base from "../playwright.config";

export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "capture-ui.spec.ts",
  globalSetup: "../tests/e2e/setup.ts",
  timeout: 60_000,
  webServer: {
    ...base.webServer,
    command: "pnpm exec vite --host 127.0.0.1 --port 3100 --strictPort",
    cwd: fileURLToPath(new URL("..", import.meta.url)),
  },
});
