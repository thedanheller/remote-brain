import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    retry: 2, // Retry flaky E2E tests
    testTimeout: 20000, // Increase timeout for E2E tests
  },
});
