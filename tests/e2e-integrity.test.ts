import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startTrialCta, trialNounPhrase } from "@/lib/stripe/trial-experiment";

/**
 * MW-V11-04: integrity of the browser suites themselves.
 *
 * A browser test fails loudly when the product breaks. It fails *silently* when
 * the test breaks — and the silent kind is what this file is for.
 *
 * The case that motivated it: `journeys.spec.ts` located the trial CTA with
 * `/start \d+ days? free/i`, the wording from before MW-V11-01 renamed it to
 * "Start free N-day trial". The locator matched nothing, so the count was zero,
 * so `test.skip(priorTrial, …)` fired, so the test skipped for every user
 * forever — reporting no failure and providing no coverage. Nothing in the
 * suite could have caught that, because a skipped test looks like a decision.
 *
 * These tests run in the unit suite, so they hold even when the seeded browser
 * environment is absent — which is exactly when the browser suites cannot
 * defend themselves.
 */

const E2E_DIR = "e2e";

const specFiles = (): string[] => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(`${dir}/${entry.name}`)
        : entry.name.endsWith(".ts")
          ? [`${dir}/${entry.name}`]
          : []
    );
  return walk(E2E_DIR);
};

const read = (path: string) => readFileSync(path, "utf8");

/**
 * Source with comments removed. A comment legitimately quotes a superseded
 * pattern in order to explain why it was superseded — the rule is about what
 * the code executes, not about what the commentary is allowed to mention.
 */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

describe("browser specs do not locate copy the app no longer renders", () => {
  const specs = specFiles();

  it("finds the spec files", () => {
    expect(specs.length).toBeGreaterThan(0);
    expect(specs).toContain("e2e/journeys.spec.ts");
  });

  it.each(specFiles())("%s does not use a superseded trial CTA pattern", (file) => {
    const source = code(file);
    // The exact shape that silently disabled a test. "Start 3 days free" and
    // "a 3 days trial" are both gone from the product.
    expect(source, `${file} matches the pre-MW-V11-01 CTA wording`).not.toMatch(
      /start \\d\+ days\?? free/i
    );
    expect(source, `${file} matches the pre-MW-V11-01 CTA wording`).not.toMatch(
      /start \\d\+ days free/i
    );
  });

  it("the current CTA and offer wording is what the specs look for", () => {
    // Derive from the helper rather than restating it, so this test tracks the
    // product instead of duplicating a literal that can drift.
    expect(startTrialCta(3)).toBe("Start free 3-day trial");
    expect(trialNounPhrase(3)).toBe("a 3-day trial");

    const journeys = read("e2e/journeys.spec.ts");
    expect(journeys).toMatch(/start free \\d\+-day trial/i);
  });
});

describe("conditional skips cannot silently remove coverage", () => {
  /**
   * A `test.skip(condition, …)` whose condition is computed from the page is
   * only safe if a wrong condition would be *noticed*. The rule enforced here:
   * every such skip must sit in a file that also asserts page identity, so a
   * test cannot both fail to find what it expects and decline to report it.
   */
  it.each(specFiles())("%s pairs conditional skips with identity assertions", (file) => {
    const source = code(file);
    // Skips whose condition is a variable, not a plain env-configuration gate.
    const conditionalSkips = [...source.matchAll(/test\.skip\(\s*(\w+)/g)]
      .map((match) => match[1])
      .filter((name) => name !== "!E2E_CONFIGURED" && name !== "true");

    if (conditionalSkips.length === 0) return;

    expect(
      source,
      `${file} skips on a computed condition but never asserts which page it is on`
    ).toMatch(/assertIdentity|assertSeededState/);
  });

  it("no spec is left focused with .only", () => {
    for (const file of specFiles()) {
      expect(read(file), `${file} contains .only, which silently drops the rest`).not.toMatch(
        /\b(test|describe)\.only\b/
      );
    }
  });
});

describe("authenticated suites fail closed when their environment is missing", () => {
  const harness = read("e2e/support/harness.ts");

  it("states BLOCKED rather than implying a pass", () => {
    expect(harness).toMatch(/BLOCKED/);
    expect(harness).toMatch(/that is not a pass/i);
  });

  it.each(["e2e/journeys.spec.ts", "e2e/daily-journey.spec.ts"])(
    "%s uses the shared blocked reason",
    (file) => {
      expect(read(file)).toContain("NOT_CONFIGURED_REASON");
    }
  );

  it("CI turns an unrun authenticated suite into a release-candidate error", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/RC_GATE/);
    expect(ci).toMatch(/cannot be a release candidate/i);
  });
});

describe("authenticated journeys run behind failure guards", () => {
  it.each(["e2e/journeys.spec.ts", "e2e/daily-journey.spec.ts"])(
    "%s installs and asserts background failure guards",
    (file) => {
      const source = read(file);
      // A journey must not be able to pass while the page threw, logged a React
      // error, or received an unexpected 4xx/5xx.
      expect(source).toContain("installFailureGuards");
      expect(source).toContain("assertNoBackgroundFailures");
    }
  );

  it("the guards cover errors, exceptions and HTTP failures", () => {
    const harness = read("e2e/support/harness.ts");
    expect(harness).toMatch(/page\.on\("console"/);
    expect(harness).toMatch(/page\.on\("pageerror"/);
    expect(harness).toMatch(/page\.on\("response"/);
  });

  it("detects the error boundary that once swallowed a broken fixture", () => {
    const harness = read("e2e/support/harness.ts");
    expect(harness).toContain("assertNoErrorBoundary");
    expect(harness).toMatch(/something went wrong/i);
  });

  it("keeps the expected-failure allowlist small and specific", () => {
    const harness = read("e2e/support/harness.ts");
    const block = harness.slice(
      harness.indexOf("const EXPECTED_FAILURES"),
      harness.indexOf("]", harness.indexOf("const EXPECTED_FAILURES"))
    );
    // A broad allowlist would restore exactly the blindness the guards remove.
    const entries = block.match(/\//g)?.length ?? 0;
    expect(entries, "the expected-failure allowlist has grown — review it").toBeLessThan(12);
    expect(block).not.toMatch(/\.\*/);
  });
});

describe("retries are reported, never treated as passes", () => {
  it("a retried test is annotated for the handoff", () => {
    const harness = read("e2e/support/harness.ts");
    expect(harness).toContain("annotateRetry");
    expect(harness).toMatch(/investigate before trusting it/i);
  });

  it("the playwright config does not retry locally", () => {
    // Retries in CI absorb infrastructure flake; retries locally hide it.
    const config = read("playwright.config.ts");
    expect(config).toMatch(/retries:\s*process\.env\.CI\s*\?\s*2\s*:\s*0/);
  });
});
