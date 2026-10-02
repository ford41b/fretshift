import { defineConfig, devices } from "@playwright/test";
const port = Number(process.env.E2E_PORT ?? 5173);
const baseURL = `http://127.0.0.1:${port}`;
const unconfiguredURL = `http://127.0.0.1:${port + 1}`;
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 30000,
  use: { baseURL: baseURL, trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      testIgnore: /unconfigured\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: baseURL,
        channel: process.env.CI ? undefined : "chrome",
      },
    },
    {
      name: "webkit",
      testIgnore: /unconfigured\.spec\.ts/,
      use: { ...devices["Desktop Safari"], baseURL: baseURL },
    },
    {
      name: "chromium-unconfigured",
      testMatch: /unconfigured\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: unconfiguredURL,
        channel: process.env.CI ? undefined : "chrome",
      },
    },
  ],
  webServer: [
    {
      command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port} --strictPort`,
      url: baseURL,
      reuseExistingServer: false,
      env: {
        VITE_SUPABASE_URL: "http://127.0.0.1:54321",
        VITE_SUPABASE_ANON_KEY: "local-e2e-public-key",
      },
    },
    {
      command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port + 1} --strictPort`,
      url: unconfiguredURL,
      reuseExistingServer: false,
      env: { VITE_SUPABASE_URL: "unconfigured", VITE_SUPABASE_ANON_KEY: "" },
    },
  ],
});
