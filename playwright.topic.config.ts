import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// API-only contract checks against the isolated test database, using current
// source without overwriting the regular production build.
export default defineConfig({
  ...base,
  testMatch: "topic-accumulation.spec.ts",
  timeout: 180_000,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/topic-accumulation.json" }],
  ],
  webServer: {
    command:
      "node node_modules/next/dist/bin/next dev --webpack --port 3101 --hostname 127.0.0.1",
    url: "http://localhost:3101/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
