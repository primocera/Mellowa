import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MODEL_POLICIES } from "@/lib/ai/model-policy";
import {
  DAILY_PLAN_LEASE_SECONDS,
  DAILY_PLAN_PROVIDER_BUDGET_MS,
} from "@/lib/ai/daily-plan-claim";
import { CRON_REGISTRY } from "@/lib/ops/cron-registry";

/**
 * Audit S4: every AI and cron route declares `maxDuration`, and the declared
 * number agrees with the time budget the code already promises.
 *
 * Next requires segment config to be a static literal in the route file, so the
 * value cannot be imported from the budget constants — this test is what keeps
 * the two from drifting. Reading the literal out of the file is the only way to
 * see it without booting every route; the numbers it is compared against are
 * the real imported constants.
 */

function routeDirs(base: string): string[] {
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(`${base}/${d.name}/route.ts`))
    .map((d) => d.name);
}

function declaredMaxDuration(file: string): number | null {
  const m = readFileSync(file, "utf8").match(/^export const maxDuration = (\d+);$/m);
  return m ? Number(m[1]) : null;
}

describe("AI routes declare a maxDuration that covers their provider budget", () => {
  // One retry per call: 2 × timeout + up to 1.5s jitter (generate-json.ts).
  const worst = (ms: number) => 2 * ms + 1_500;
  const safety = worst(MODEL_POLICIES["safety-check"].timeoutMs);

  for (const dir of routeDirs("src/app/api/ai")) {
    it(`${dir}`, () => {
      const declared = declaredMaxDuration(`src/app/api/ai/${dir}/route.ts`);
      expect(declared, `src/app/api/ai/${dir}/route.ts has no maxDuration`).not.toBeNull();

      const policy = MODEL_POLICIES[dir as keyof typeof MODEL_POLICIES];
      expect(policy, `no model policy for ${dir}`).toBeTruthy();
      // Safety check, then a generation and one corrective generation.
      const budgetMs = safety + 2 * worst(policy.timeoutMs);
      expect(declared! * 1000, "the platform would kill a request still inside its budget")
        .toBeGreaterThanOrEqual(budgetMs);
    });
  }

  it("daily-plan outlives its claim lease and shared provider budget", () => {
    const declared = declaredMaxDuration("src/app/api/ai/daily-plan/route.ts")!;
    expect(declared).toBeGreaterThanOrEqual(DAILY_PLAN_LEASE_SECONDS);
    expect(declared * 1000).toBeGreaterThan(DAILY_PLAN_PROVIDER_BUDGET_MS);
  });
});

describe("cron routes enforce the timeout the registry declares", () => {
  for (const job of CRON_REGISTRY) {
    it(`${job.id} → ${job.timeoutSeconds}s`, () => {
      const file = `src/app${job.route}/route.ts`;
      expect(declaredMaxDuration(file), `${file} maxDuration`).toBe(job.timeoutSeconds);
    });
  }
});
