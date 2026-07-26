import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recoveryNoticeFor } from "@/lib/stripe/recovery";
import { entitlementFor } from "@/lib/stripe/plans";

/**
 * MW-V10-03: failure-state completion for the authenticated daily journey.
 *
 * What is checked here is the part a browser test cannot pin down cheaply: that
 * every billing state which blocks generation has exactly one recovery route,
 * that the copy leads with what still works, and that the completion path
 * cannot report a success the server did not confirm.
 */

describe("billing recovery notice", () => {
  it("covers every status that blocks generation but keeps read access", () => {
    // The contract: if a status cannot generate, the user must be told why and
    // given a route. Nothing may block generation silently.
    const blocked = (
      ["past_due", "unpaid", "canceled"] as const
    ).filter((s) => !entitlementFor(s).generate);
    expect(blocked).toEqual(["past_due", "unpaid", "canceled"]);
    for (const status of blocked) {
      const notice = recoveryNoticeFor({ status });
      expect(notice, `${status} has no recovery notice`).not.toBeNull();
      expect(notice!.href).toBe("/billing");
      expect(entitlementFor(status).read).toBe(true);
    }
  });

  it("says nothing for a healthy subscription", () => {
    expect(recoveryNoticeFor({ status: "trialing" })).toBeNull();
    expect(recoveryNoticeFor({ status: "active" })).toBeNull();
    expect(recoveryNoticeFor({ status: "none" })).toBeNull();
    expect(recoveryNoticeFor({ status: "incomplete" })).toBeNull();
  });

  it("leads with what is kept, before what is broken", () => {
    for (const status of ["past_due", "unpaid", "canceled"]) {
      const n = recoveryNoticeFor({ status })!;
      expect(n.kept).toMatch(/stays? readable/i);
      // The reassurance is its own sentence, so it cannot be buried mid-clause.
      expect(n.kept.endsWith(".")).toBe(true);
    }
  });

  it("never uses pressure, loss or wellbeing framing", () => {
    const all = (["past_due", "unpaid", "canceled"] as const)
      .map((status) => recoveryNoticeFor({ status })!)
      .concat(
        recoveryNoticeFor({ status: "active", cancelAtPeriodEnd: true })!,
        recoveryNoticeFor({
          status: "trialing",
          cancelAtPeriodEnd: true,
          periodEndLabel: "2 August 2026",
        })!
      );
    for (const n of all) {
      const text = `${n.kept} ${n.action} ${n.cta}`.toLowerCase();
      for (const banned of [
        "immediately",
        "urgent",
        "act now",
        "deleted",
        "lose your",
        "don't lose",
        "expire",
        "last chance",
        "streak",
        "progress",
        "wellbeing",
        "health",
      ]) {
        expect(text, `"${banned}" in the ${n.state} notice`).not.toContain(banned);
      }
    }
  });

  it("treats a pending cancellation as information, not a problem", () => {
    const n = recoveryNoticeFor({
      status: "active",
      cancelAtPeriodEnd: true,
      periodEndLabel: "2 August 2026",
    })!;
    expect(n.state).toBe("ending");
    expect(n.tone).toBe("info");
    expect(n.kept).toContain("2 August 2026");
    expect(n.action).toMatch(/not to renew/i);
  });

  it("omits the date rather than inventing one when it is unknown", () => {
    const n = recoveryNoticeFor({ status: "active", cancelAtPeriodEnd: true })!;
    expect(n.kept).toMatch(/end of your current period/i);
    expect(n.kept).not.toMatch(/\d{4}/);
  });

  it("does not raise a cancellation notice for a state that already has one", () => {
    // canceled is already terminal — it must not also read as "ending".
    expect(
      recoveryNoticeFor({ status: "canceled", cancelAtPeriodEnd: true })!.state
    ).toBe("canceled");
    expect(
      recoveryNoticeFor({ status: "past_due", cancelAtPeriodEnd: true })!.state
    ).toBe("past_due");
  });
});

describe("only one banner at a time", () => {
  const banner = readFileSync(
    "src/components/dailyflow/trial-banner.tsx",
    "utf8"
  );
  const layout = readFileSync("src/app/(app)/layout.tsx", "utf8");

  it("the trial banner stands down for a trial set not to renew", () => {
    expect(banner).toContain("if (sub.cancelAtPeriodEnd) return null;");
    // …and the recovery notice picks that state up, so it is never unreported.
    expect(
      recoveryNoticeFor({ status: "trialing", cancelAtPeriodEnd: true })
    ).not.toBeNull();
  });

  it("renders the recovery notice on every authenticated surface", () => {
    expect(layout).toContain("BillingRecoveryBanner");
  });
});

describe("completion is server-confirmed", () => {
  const today = readFileSync(
    "src/components/dailyflow/today-plan-v2.tsx",
    "utf8"
  );

  it("drops a second tap while a save is in flight", () => {
    expect(today).toContain("if (savingKeys.has(key)) return;");
  });

  it("takes the final state from the server response, not the local guess", () => {
    expect(today).toContain("setDoneItems((d) => ({ ...d, [key]: data.done }))");
    expect(today).toMatch(/typeof data\?\.done !== "boolean"/);
  });

  it("confirms 'Marked done' only after the server stored it", () => {
    // The Now button must not set the confirmation itself. (Clearing it — as
    // the Undo control does — is fine; claiming a completion is not.)
    expect(today).not.toMatch(/setJustDone\(nowSelection/);
    expect(today).toContain('if (data.done && source === "now") setJustDone(key)');
  });

  it("says what was preserved when a save fails", () => {
    expect(today).toMatch(/it isn't marked done — nothing else about your plan changed/);
    expect(today).toMatch(/it's still marked done — nothing else about your plan changed/);
  });

  it("uses no provider or technical language in the failure copy", () => {
    for (const banned of ["Anthropic", "500", "fetch failed", "network error", "API"]) {
      expect(today).not.toContain(`${banned}`.length > 3 ? banned : `"${banned}"`);
    }
  });
});

describe("a stale tab moves forward, never backward", () => {
  const today = readFileSync(
    "src/components/dailyflow/today-plan-v2.tsx",
    "utf8"
  );

  it("handles an in-progress repair as a claimed request, not a failure", () => {
    expect(today).toMatch(/res\.status === 409/);
    expect(today).toMatch(/didn't start a second one/);
  });

  it("keeps the newer plan when Undo hits a version conflict", () => {
    expect(today).toMatch(/newer plan is the one you have/);
    // Never offers the user a way to overwrite the newer version with the one
    // this page remembers. (The comment explaining that rule is excluded.)
    const code = today
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
    expect(code).not.toMatch(/force|overwrite|discard the newer/i);
  });

  it("treats a deduplicated repair as already committed", () => {
    expect(today).toContain("data.deduplicated");
  });

  it("offers a reload rather than silently refreshing under the user", () => {
    expect(today).toMatch(/Reload today/);
  });
});

describe("seeded state matrix exists and is closed", () => {
  const seed = readFileSync("scripts/seed-test-user.mjs", "utf8");
  const spec = readFileSync("e2e/daily-journey.spec.ts", "utf8");
  const config = readFileSync("playwright.config.ts", "utf8");

  const STATES = [
    "no-plan",
    "plan-ready",
    "partly-done",
    "all-done",
    "past-due",
    "canceled",
    "ending",
    "bad-timezone",
  ];

  it("seeds every state the matrix asserts on", () => {
    for (const state of STATES) {
      expect(seed, `seed script cannot produce ${state}`).toContain(state);
      expect(spec, `no browser assertion for ${state}`).toContain(state);
    }
  });

  it("rejects an unknown state instead of silently seeding the default", () => {
    expect(seed).toMatch(/Unknown --state=/);
    expect(seed).toMatch(/process\.exit\(1\)/);
  });

  it("rebuilds the plan each run so states cannot leak into each other", () => {
    expect(seed).toMatch(/from\("daily_plans"\)\s*\.delete\(\)/);
    expect(seed).toMatch(/from\("plan_completions"\)\s*\.delete\(\)/);
  });

  it("runs the matrix at 320px as its own project", () => {
    expect(config).toContain("mobile-320");
    expect(config).toMatch(/width: 320/);
  });

  it("checks overflow and nav overlap rather than trusting a padding value", () => {
    expect(spec).toContain("assertNoHorizontalOverflow");
    expect(spec).toContain("assertNotCoveredByNav");
  });
});
