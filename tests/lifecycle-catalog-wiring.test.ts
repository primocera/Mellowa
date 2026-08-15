import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  LIFECYCLE_MESSAGES,
  isDeliverableTemplate,
  messageSpecFor,
  allowlistedDeepLink,
} from "@/lib/email/lifecycle-catalog";
import { EMAIL_CATEGORIES } from "@/lib/email/categories";
import { deliverEmail, type DeliverDeps } from "@/lib/email/deliver";

/**
 * MW-12: the lifecycle catalog is the executable source of truth for email. Every
 * delivery resolves through it before queuing; consent class comes from the one
 * category registry; unknown templates are refused; optional mail carries an
 * unsubscribe; deep links are relative and allowlisted.
 */

describe("consent class is derived from the single category registry", () => {
  it("every catalog entry's consent class matches EMAIL_CATEGORIES exactly", () => {
    for (const [template, spec] of Object.entries(LIFECYCLE_MESSAGES)) {
      expect(spec.consentClass).toBe(
        EMAIL_CATEGORIES[template as keyof typeof EMAIL_CATEGORIES]
      );
    }
  });

  it("every EMAIL_CATEGORIES template has a catalog entry (no drift either way)", () => {
    for (const template of Object.keys(EMAIL_CATEGORIES)) {
      expect(isDeliverableTemplate(template), `${template} missing from catalog`).toBe(true);
      expect(messageSpecFor(template)).not.toBeNull();
    }
  });
});

describe("delivery resolves through the catalog", () => {
  it("deliver.ts gates on isDeliverableTemplate before queuing", () => {
    const src = readFileSync("src/lib/email/deliver.ts", "utf8");
    expect(src).toContain("isDeliverableTemplate");
  });

  it("refuses an unknown template without touching the ledger or provider", async () => {
    const claim = vi.fn();
    const send = vi.fn();
    const deps = {
      claim,
      finalize: vi.fn(),
      send,
    } as unknown as DeliverDeps;
    const res = await deliverEmail(
      { eventKey: "x", template: "not_a_real_template", to: "a@b.co", subject: "s", html: "<p>h</p>" },
      deps
    );
    expect(res).toEqual({ sent: false, status: "failed_permanent" });
    expect(claim).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("accepts a registered template (claims the ledger)", async () => {
    const claim = vi.fn(async () => ({ id: "1", status: "pending", attempts: 0 }));
    const deps = {
      claim,
      finalize: vi.fn(),
      send: vi.fn(async () => ({ sent: true, providerId: "re_1" })),
    } as unknown as DeliverDeps;
    const res = await deliverEmail(
      { eventKey: "y", template: "trial_ending", to: "a@b.co", subject: "s", html: "<p>h</p>" },
      deps
    );
    expect(res.sent).toBe(true);
    expect(claim).toHaveBeenCalledOnce();
  });
});

describe("every production deliverEmail caller uses a catalog template", () => {
  const CALLER_FILES = [
    "src/app/api/ai/daily-plan/route.ts",
    "src/app/api/cron/daily-reminders/route.ts",
    "src/app/api/cron/trial-reminders/route.ts",
    "src/app/api/email/welcome/route.ts",
    "src/app/api/stripe/cancel/route.ts",
    "src/app/api/stripe/webhook/route.ts",
    "src/app/auth/callback/route.ts",
    "src/lib/account-deletion/worker.ts",
  ];

  it("all `template: \"…\"` literals in callers are registered", () => {
    const seen = new Set<string>();
    for (const file of CALLER_FILES) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/template:\s*"([a-z_]+)"/g)) {
        seen.add(m[1]);
        expect(isDeliverableTemplate(m[1]), `${m[1]} in ${file} not in catalog`).toBe(true);
      }
    }
    // Sanity: we actually scanned some templates.
    expect(seen.size).toBeGreaterThan(3);
  });
});

describe("optional mail carries an unsubscribe; deep links are safe", () => {
  it("optional-consent template callers pass an unsubscribeUrl", () => {
    const reminders = readFileSync("src/app/api/cron/daily-reminders/route.ts", "utf8");
    // Both optional messages (daily_reminder, onboarding_nudge) are sent here.
    for (const t of Object.keys(EMAIL_CATEGORIES).filter(
      (k) => EMAIL_CATEGORIES[k as keyof typeof EMAIL_CATEGORIES] === "optional"
    )) {
      expect(reminders).toContain(`template: "${t}"`);
    }
    expect(reminders).toContain("unsubscribeUrl: optOut");
  });

  it("allowlistedDeepLink accepts internal allowlisted paths only", () => {
    expect(allowlistedDeepLink("/today")).toBe("/today");
    expect(allowlistedDeepLink("/pricing?ref=x")).toBe("/pricing?ref=x");
    expect(allowlistedDeepLink("https://evil.example/today")).toBeNull();
    expect(allowlistedDeepLink("//evil.example")).toBeNull();
    expect(allowlistedDeepLink("/secret-admin")).toBeNull();
  });
});
