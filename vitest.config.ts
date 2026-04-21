import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Unit tests only by default. E2E lives in test/e2e and is opt-in via
    // `pnpm test:e2e` (see package.json), because it requires external
    // services (ath-protocol/gateway + mock-oauth) to be wired in.
    include: ["test/unit/**/*.test.ts"],
  },
});
