import { defineConfig } from "vitest/config";
import path from "path";

// Local unit tests only — no CI, no coverage gates (project rule).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    /*
     * Vitest's 5s default is too tight for this suite.
     *
     * 92 test files run in parallel on one machine, and several of them walk
     * the source tree with synchronous reads. Under a contention spike any of
     * them can cross 5s — and which one loses is luck, so a different pair
     * failed on each run: two copy scans, then a money formatter and a consent
     * check that have nothing in common except when they were scheduled.
     *
     * That shape is worse than a slow suite. A timeout is reported as a failed
     * assertion, so `bans diet-culture phrases` fails with no offending phrase
     * named and reads as a real copy violation. The reader re-runs it, it
     * passes, and the lesson learned is that a red suite means "run it again"
     * — at which point the gate has stopped carrying information.
     *
     * These are assertions about content and arithmetic, not about latency.
     * Nothing here is trying to measure speed, so nothing here should fail
     * because the machine was busy. Genuine hangs still surface, 30s later.
     */
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      // Next's "server-only" guard throws outside Next; stub it for tests.
      "server-only": path.resolve(__dirname, "tests/server-only-stub.ts"),
      "@": path.resolve(__dirname, "src"),
    },
  },
});
