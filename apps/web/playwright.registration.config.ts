import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./registration/e2e",
  outputDir: "./test-results/registration",
  timeout: 90000,
  workers: 1,
  use: { baseURL: "http://localhost:5194", viewport: { width: 1000, height: 800 } },
});
