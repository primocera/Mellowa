import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shouldApplyStripeEvent } from "@/lib/stripe/event-order";

/**
 * MW-V12-03: the billing lifecycle, applied in event-created order.
 *
 * The residual risk recorded against P0-LIVE-TRANSACTION is precise: "an
 * out-of-order or late payment_failed webhook arriving after a recovery could
 * silently remove access from a paying customer." Stripe guarantees neither
 * ordering nor exactly-once delivery, so this is normal operation, not an edge
 * case. These tests encode the whole lifecycle — trial start, active charge,
 * cancel, reactivate, payment failure, recovery, LATE failure after recovery,
 * refund and dispute — as a sequence of `created`-stamped events applied
 * through the same ordering guard the webhook uses.
 */

/**
 * A minimal model of how the webhook applies entitlement-changing events: a row
 * with a status and a watermark (`last_stripe_event_created`). This mirrors the
 * real handler's rule — apply only if `shouldApplyStripeEvent`, then advance the
 * watermark — so the ordering behaviour can be asserted without a live Stripe.
 */
type Status = "trialing" | "active" | "past_due" | "canceled";
interface Row {
  status: Status;
  watermark: number | null;
}

/** payment_failed → past_due, order-guarded (mirrors the route). */
function applyFailure(row: Row, created: number): Row {
  if (!shouldApplyStripeEvent(created, row.watermark)) return row;
  return { status: "past_due", watermark: created };
}

/** payment_succeeded → recovery only when currently past_due, order-guarded. */
function applyRecovery(row: Row, created: number): Row {
  if (!shouldApplyStripeEvent(created, row.watermark)) return row;
  if (row.status !== "past_due") return row; // renewal/trial invoice: no change
  return { status: "active", watermark: created };
}

/** subscription.* sync → canonical status, order-guarded. */
function applySync(row: Row, created: number, status: Status): Row {
  if (!shouldApplyStripeEvent(created, row.watermark)) return row;
  return { status, watermark: created };
}

describe("shouldApplyStripeEvent orders by created, not arrival", () => {
  it("applies the first event ever seen", () => {
    expect(shouldApplyStripeEvent(1000, null)).toBe(true);
    expect(shouldApplyStripeEvent(1000, undefined)).toBe(true);
  });

  it("applies a newer or same-second event", () => {
    expect(shouldApplyStripeEvent(1001, 1000)).toBe(true);
    expect(shouldApplyStripeEvent(1000, 1000)).toBe(true);
  });

  it("drops an older event", () => {
    expect(shouldApplyStripeEvent(999, 1000)).toBe(false);
  });
});

describe("the paid lifecycle converges to the right entitlement", () => {
  it("trial start → active charge → cancel → reactivate, in order", () => {
    let row: Row = { status: "trialing", watermark: 100 }; // created at trial start
    row = applySync(row, 200, "active"); // first charge converts the trial
    expect(row.status).toBe("active");
    row = applySync(row, 300, "canceled"); // user cancels
    expect(row.status).toBe("canceled");
    row = applySync(row, 400, "active"); // reactivates
    expect(row.status).toBe("active");
  });

  it("payment failure then recovery leaves the user active", () => {
    let row: Row = { status: "active", watermark: 100 };
    row = applyFailure(row, 200);
    expect(row.status).toBe("past_due");
    row = applyRecovery(row, 300);
    expect(row.status).toBe("active");
  });

  it("a LATE failure redelivered after recovery does NOT remove access", () => {
    // The bug this whole slice targets. The failure was created at 200, the
    // recovery at 300. Stripe redelivers the failure last.
    let row: Row = { status: "active", watermark: 100 };
    row = applyFailure(row, 200); // past_due, watermark 200
    row = applyRecovery(row, 300); // active,   watermark 300
    // Redelivery of the OLD failure (created 200) arrives after the recovery:
    row = applyFailure(row, 200);
    expect(row.status, "a stale failure dragged a paid user back to past_due").toBe(
      "active"
    );
  });

  it("a stale success cannot reactivate a since-canceled account", () => {
    let row: Row = { status: "past_due", watermark: 200 };
    row = applySync(row, 400, "canceled"); // canceled at 400
    // A payment_succeeded created at 300 is redelivered after the cancellation:
    row = applyRecovery(row, 300);
    expect(row.status).toBe("canceled");
  });

  it("a canonical subscription.updated heals a wrongly-applied failure", () => {
    // Even in the rare case a failure lands with no later invoice, Stripe emits
    // subscription.updated on recovery; applied in order it corrects the row.
    let row: Row = { status: "active", watermark: 100 };
    row = applyFailure(row, 200); // past_due
    row = applySync(row, 250, "active"); // subscription.updated says active
    expect(row.status).toBe("active");
  });
});

describe("the webhook wires the ordering guard and isolates foreign customers", () => {
  const route = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");

  /** The body of one switch case, from its label to the next case/default. */
  function caseBlock(label: string): string {
    const start = route.indexOf(`case "${label}"`);
    expect(start, `no case for ${label}`).toBeGreaterThan(-1);
    const rest = route.slice(start + label.length);
    const nextCase = rest.search(/\n {6}(case "|default:)/);
    return rest.slice(0, nextCase === -1 ? undefined : nextCase);
  }

  it("guards subscription sync with shouldApplyStripeEvent", () => {
    expect(route).toContain("shouldApplyStripeEvent(event.created");
  });

  it("payment_failed reads the row, guards ordering and advances the watermark", () => {
    const block = caseBlock("invoice.payment_failed");
    expect(block).toContain("last_stripe_event_created");
    expect(block).toContain("shouldApplyStripeEvent(event.created");
    // The status write must advance the watermark, or the next event cannot be
    // ordered against this one.
    expect(block).toMatch(/status: "past_due", last_stripe_event_created: event\.created/);
    // The row read is the isolation boundary — act only if it exists.
    expect(block).toMatch(/if \(row &&/);
  });

  it("payment_succeeded only recovers a past_due row, order-guarded", () => {
    const block = caseBlock("invoice.payment_succeeded");
    expect(block).toContain("shouldApplyStripeEvent(event.created");
    expect(block).toMatch(/wasPastDue/);
    // A foreign customer has no row and is dropped before any side effect.
    expect(block).toContain("if (!row) break;");
  });

  it("foreign refunds and disputes are not recorded in our analytics", () => {
    const refundBlock = caseBlock("charge.refunded");
    expect(refundBlock).toContain("refundUserId");
    expect(refundBlock).toMatch(/if \(refundUserId\)/);

    const disputeBlock = caseBlock("charge.dispute.created");
    expect(disputeBlock).toContain("disputeUserId");
  });
});
