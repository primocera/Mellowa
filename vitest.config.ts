import { defineConfig } from "vitest/config";
import path from "path";

// Local unit tests only — no CI, no coverage gates (project rule).
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
  resolve: {
    alias: {
      // Next's "server-only" guard throws outside Next; stub it for tests.
      "server-only": path.resolve(__dirname, "tests/server-only-stub.ts"),
      "@": path.resolve(__dirname, "src"),
    },
  },
});
