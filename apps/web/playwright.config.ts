// Playwright (dev only, Stage 1b-ii): UI checks on fixture-only previews under /dev. Reuses a
// running `pnpm dev` (port 3000), else starts one.
//   pnpm --filter @oksy/web e2e
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.e2e.ts", // not *.test.ts: vitest must not pick these up
  timeout: 60_000,
  use: { baseURL: "http://localhost:3000", screenshot: "only-on-failure" },
  webServer: { command: "pnpm exec next dev --port 3000", url: "http://localhost:3000/api/health", reuseExistingServer: true, timeout: 120_000 },
});
