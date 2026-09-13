import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3101",
    headless: true,
    timezoneId: "Asia/Seoul",
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run start -- --port 3101 --hostname 127.0.0.1",
    url: "http://localhost:3101/api/health",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
