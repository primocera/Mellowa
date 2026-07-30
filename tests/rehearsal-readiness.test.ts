import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMAIL_CATEGORIES } from "@/lib/email/categories";

/**
 * MW-V11-06: readiness of the two owner-run rehearsals.
 *
 * Neither rehearsal can be executed from here — they need real money and a real
 * inbox. What *can* be checked is whether they are worth executing: a checklist
 * with no stop condition, no cleanup, or a step whose expected result is not
 * written down produces an afternoon of work and no usable evidence.
 *
 * So this file gates the runbooks the way `release-manifest.test.ts` gates the
 * scorecard, and separately proves the properties the runbooks *assume* about
 * the code — the ones that would make a live step meaningless if they were
 * false.
 *
 * It deliberately does not re-test consent enforcement, DST, quiet hours or
 * safety suppression: `tests/reminder-reliability.test.ts` owns those, and
 * duplicating them here would mean two places to update and two chances to
 * disagree.
 */

/**
 * Markdown wraps prose across lines, so a sentence that reads as one phrase is
 * several lines in the file. Match against a whitespace-collapsed copy, or
 * every assertion here silently depends on where the text happened to wrap.
 */
const flat = (source: string) => source.replace(/\s+/g, " ");

/**
 * Read a runbook, refusing an empty one. Some assertions below check that a
 * document does *not* say something, and an empty string satisfies all of them
 * — a silently-failed read would report a green gate over nothing.
 */
function readDoc(path: string): string {
  const contents = readFileSync(path, "utf8");
  if (contents.trim().length < 200) {
    throw new Error(
      `${path} read as ${contents.length} chars — refusing to assert against an empty document`
    );
  }
  return contents;
}

const transactionRaw = readDoc("docs/runbooks/live-transaction-rehearsal.md");
const cronRaw = readDoc("docs/ops-cron.md");
const transaction = flat(transactionRaw);
const cron = flat(cronRaw);

describe("the live transaction rehearsal is executable", () => {
  it("names the blocker it closes and the current scorecard", () => {
    expect(transaction).toContain("P0-LIVE-TRANSACTION");
    expect(transaction).toContain("launch-go-no-go-v11.md");
    // The v9 scorecard it used to point at is three releases stale.
    expect(transaction).not.toMatch(/launch-go-no-go-v9\.md/);
  });

  it("states that Claude Code executes none of it", () => {
    expect(transaction).toMatch(/Claude Code never runs any of them/i);
  });

  it("records expected AND observed for every step", () => {
    // A checklist with only an "expected" column invites ticking rather than
    // reading. Both columns exist, so a divergence has somewhere to be written.
    expect(transaction).toMatch(/\| Expected \| Observed \|/);
    expect(transaction).toMatch(/Observed differs from Expected, the outcome is FAIL/i);
  });

  it("covers the four steps the P0 names, and refunds in cleanup", () => {
    for (const step of [
      /first charge/i,
      /cancel/i,
      /unsubscribe/i,
      /reactivate/i,
      /refund/i,
    ]) {
      expect(transaction, `the runbook never covers ${step}`).toMatch(step);
    }
  });

  it("has stop conditions, cleanup and rollback", () => {
    expect(transaction).toMatch(/## Stop conditions/i);
    expect(transaction).toMatch(/## Cleanup/i);
    expect(transaction).toMatch(/## Rollback/i);
    // The most important stop condition of all.
    expect(transaction).toMatch(/charge on a date or of an amount the user was not shown/i);
  });

  it("tells the operator not to write customer data into a committed file", () => {
    expect(transaction).toMatch(/Evidence hygiene/i);
    expect(transaction).toMatch(/never record the card number/i);
    expect(transaction).toMatch(/committed to the repository/i);
  });

  it("checks idempotency rather than assuming it", () => {
    expect(transaction).toMatch(/replay one webhook event/i);
    expect(transaction).toMatch(/out of order/i);
    expect(transaction).toMatch(/no double charge|no double bill/i);
  });

  it("rehearses the failure → recovery → late-failure → refund path (MW-V12-03)", () => {
    // The four steps the v11 P0 named were charge/cancel/unsubscribe/reactivate.
    // MW-V12-03 adds the real-money lifecycle the accepted-risk called out: a
    // payment failure and recovery, a LATE failure redelivered after recovery,
    // and an explicit refund step — not only the cleanup refund.
    expect(transaction).toMatch(/Payment failure then recovery/i);
    expect(transaction).toMatch(/Late failure after recovery/i);
    expect(transaction).toMatch(/event\.created order|follows Stripe, not arrival order/i);
    expect(transaction).toMatch(/event-order\.ts|shouldApplyStripeEvent/);
  });

  it("aborts on the isolation and currency failures MW-V12-03 hardened", () => {
    expect(transaction).toMatch(/currency other than EUR/i);
    expect(transaction).toMatch(/foreign-product\) event mutating a Mellowa row/i);
    expect(transaction).toMatch(/email the flow did not expect/i);
  });

  it("requires a safety-blocked input to produce no upsell", () => {
    expect(transaction).toMatch(/no generation, no entitlement consumed, \*\*no upsell/i);
  });

  it("names alert thresholds with somewhere to read them", () => {
    expect(transaction).toMatch(/## Alert thresholds/i);
    expect(transaction).toMatch(/adoptedSubscriptions/);
    expect(transaction).toMatch(/dead letter/i);
  });
});

describe("the reminder rehearsal is executable", () => {
  it("names the blocker it closes and the current scorecard", () => {
    expect(cron).toContain("P1-REMINDER-REHEARSAL");
    expect(cron).toContain("launch-go-no-go-v11.md");
  });

  it("covers consent, window, controls, idempotency, unsubscribe and failure", () => {
    for (const section of [
      /### 1\. Consent and preview/,
      /### 2\. Delivery in the disclosed window/,
      /### 3\. Controls take effect/,
      /### 4\. Idempotency and overlap/,
      /### 5\. Unsubscribe/,
      /### 6\. Failure and backlog/,
      /### 7\. Lifecycle alignment/,
    ]) {
      expect(cron, `missing ${section}`).toMatch(section);
    }
  });

  it("exercises the native one-click unsubscribe, not just the footer link", () => {
    // RFC 8058 POST is a different code path from the footer GET, and it is the
    // one Gmail and Apple Mail actually use.
    expect(cron).toMatch(/native.*unsubscribe|RFC 8058/i);
  });

  it("proves unsubscribe does not suppress transactional mail", () => {
    expect(cron).toMatch(/### 8\. Unsubscribe suppresses the right mail/);
    expect(cron).toMatch(/it still arrives/i);
  });

  it("has stop conditions and cleanup", () => {
    expect(cron).toMatch(/Stop conditions/i);
    expect(cron).toMatch(/### 9\. Cleanup/);
    expect(cron).toMatch(/Two reminders for one local day/i);
    expect(cron).toMatch(/before.*the user's chosen local time/i);
  });

  it("is honest about what a live run cannot prove", () => {
    // DST and safety suppression are fixture territory; claiming a live run
    // covers them would be the kind of overreach this pack exists to prevent.
    expect(cron).toMatch(/cannot prove, and is not asked to/i);
    expect(cron).toMatch(/reminder-reliability\.test\.ts/);
  });
});

describe("properties the rehearsals assume about the code", () => {
  it("every email template is classified transactional or optional", () => {
    // Unsubscribe semantics depend entirely on this split being total. An
    // unclassified template is one that could be suppressed when it must not
    // be, or kept when the user asked for it to stop.
    const values = Object.values(EMAIL_CATEGORIES);
    expect(values.length).toBeGreaterThan(0);
    for (const [name, category] of Object.entries(EMAIL_CATEGORIES)) {
      expect(["transactional", "optional"], `${name} is "${category}"`).toContain(category);
    }
  });

  it("billing and account mail is transactional, so opting out cannot stop it", () => {
    for (const template of ["trial_started", "trial_ending", "trial_ended", "canceled"]) {
      expect(
        EMAIL_CATEGORIES[template as keyof typeof EMAIL_CATEGORIES],
        `${template} must be transactional`
      ).toBe("transactional");
    }
  });

  it("the daily reminder is the thing unsubscribe actually stops", () => {
    expect(EMAIL_CATEGORIES.daily_reminder).toBe("optional");
    expect(EMAIL_CATEGORIES.onboarding_nudge).toBe("optional");
    // And nothing else is: every other template must keep arriving.
    const optional = Object.entries(EMAIL_CATEGORIES)
      .filter(([, category]) => category === "optional")
      .map(([name]) => name)
      .sort();
    expect(optional).toEqual(["daily_reminder", "onboarding_nudge"]);
  });

  it("a duplicated or delayed cron run cannot duplicate a message", () => {
    const route = readFileSync("src/app/api/cron/daily-reminders/route.ts", "utf8");
    // Two independent guards, and the ledger is the one that actually holds:
    // the lease fails open on purpose so a lease-table problem cannot silently
    // stop reminders for everyone.
    expect(route).toContain("acquireCronLease");
    expect(route).toContain("eventKey: r.dedupeKey");
  });

  /*
   * Not re-tested here: that the /admin delivery-health query never selects
   * `to_email`, `subject` or `html`. `tests/reminder-reliability.test.ts`
   * already asserts it field by field, and the rehearsal's instruction to read
   * those counts is safe because of that test. Duplicating it would create two
   * places to update and two chances for them to disagree.
   */
  it("points the operator at a health view that is already proven private", () => {
    const reminders = readFileSync("tests/reminder-reliability.test.ts", "utf8");
    expect(
      reminders,
      "the delivery-health privacy assertion this rehearsal relies on has gone"
    ).toMatch(/for \(const field of \["to_email", "subject", "html"\]\)/);
  });
});
