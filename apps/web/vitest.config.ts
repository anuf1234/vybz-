import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration files share one test database and truncate tables, so run files one at a time.
    fileParallelism: false,
  },
});
