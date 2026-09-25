import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts", "tests/src/**/*.test.ts"],
    environment: "node",
    // A test that takes longer than this is doing something over the network,
    // which a unit test should not be doing. The database tests under `tests/`
    // are the exception and raise it themselves: they are skipped entirely
    // unless TEST_DATABASE_URL is set.
    testTimeout: 5_000,
    restoreMocks: true,
  },
});
