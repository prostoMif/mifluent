import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    environment: "node",
    // A test that takes longer than this is doing something over the network,
    // which a unit test should not be doing.
    testTimeout: 5_000,
    restoreMocks: true,
  },
});
