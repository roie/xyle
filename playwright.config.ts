import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.XYLE_PORT ?? 4173);
const baseURL = `http://127.0.0.1:${port}`;

const webmcpProject = {
  name: "webmcp",
  testMatch: /webmcp\.spec\.ts/,
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    headless: false,
    launchOptions: {
      args: [
        "--enable-experimental-web-platform-features",
        "--enable-features=WebMCPTesting,DevToolsWebMCPSupport",
      ],
    },
  },
};

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  // specs share one live site copy; publishing tests must not race
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node e2e/start-xyle.mts",
    url: `${baseURL}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    ...(process.env.XYLE_WEBMCP === "1" ? [webmcpProject] : []),
  ],
});
