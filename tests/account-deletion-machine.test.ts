import { beforeEach, describe, expect, it } from "vitest";
import {
  processDeletionRequest,
  deletionBackoffMinutes,
  type DeletionDeps,
  type DeletionJob,
  type DeletionJobPatch,
  type OwnershipResult,
  type ReadResult,
  type RegistryEntry,
  type SubscriptionRow,
} from "@/lib/account-deletion/machine";

/**
 * MW-V18-04: the durable deletion state machine is correct, fail-closed and
 * resumable. Every I/O call is faked here so the pure core is exercised
 * directly. The invariants under test:
 *   - billing is verified/cancelled before the identity is deleted;
 *   - a shared-Stripe foreign/unowned customer is never cancelled or deleted
 *     over (billing_reconciliation_required, no status advance);
 *   - an ambiguous auth read fails closed (never "deleted");
 *   - residuals must be COUNTED to zero, not merely deleted;
 *   - the confirmation email is best-effort and never traps a done deletion;
 *   - completion minimises the row (user id nulled) and records the event once;
 *   - a failed pass advances nothing and stays fully resumable.
 */

type Persisted = Array<{ id: string; patch: Partial<DeletionJobPatch> }>;

interface FakeState {
  sub: ReadResult<SubscriptionRow>;
  ownership: OwnershipResult;
  cancel: { ok: boolean; alreadyGone?: boolean; error?: string };
  del: { notFound: boolean; error?: string };
  getUser: { present: boolean; error: boolean };
  counts: Record<string, ReadResult<number>>;
  deleteRows: { error: boolean };
  queued: { queued: boolean };
  registry: RegistryEntry[];
  events: number;
  cancelled: string[];
  persisted: Persisted;
}

function makeState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    sub: { data: null, error: false },
    ownership: { kind: "missing" },
    cancel: { ok: true },
    del: { notFound: false },
    getUser: { present: false, error: false },
    counts: {},
    deleteRows: { error: false },
    queued: { queued: true },
    registry: [],
    events: 0,
    cancelled: [],
    persisted: [],
    ...overrides,
  };
}

function makeDeps(state: FakeState): DeletionDeps {
  return {
    registry: state.registry,
    async readSubscription() {
      return state.sub;
    },
    async verifyOwnership() {
      return state.ownership;
    },
    async cancelSubscription(id) {
      state.cancelled.push(id);
      return state.cancel;
    },
    async deleteAuthUser() {
      return state.del;
    },
    async getUserById() {
      return state.getUser;
    },
    async countRows(table) {
      return state.counts[table] ?? { data: 0, error: false };
    },
    async deleteRows() {
      return state.deleteRows;
    },
    async queueNotification() {
      return state.queued;
    },
    recordCompletedEvent() {
      state.events += 1;
    },
    async persist(id, patch) {
      state.persisted.push({ id, patch });
      Object.assign(latest, patch);
    },
    now: () => 1_000_000_000_000,
  };
  // `latest` accumulates persisted patches so a test can assert the final row.
}

// Shared accumulator of the last-written fields (reset per test).
let latest: Partial<DeletionJobPatch> = {};

function baseJob(overrides: Partial<DeletionJob> = {}): DeletionJob {
  return {
    id: "req_1",
    user_id: "u1",
    status: "requested",
    attempts: 0,
    billing_ref: null,
    recipient_email: "person@example.com",
    residual_tables: [],
    ...overrides,
  };
}

beforeEach(() => {
  latest = {};
});

describe("processDeletionRequest — happy paths", () => {
  it("drives a no-billing job all the way to completed in one pass", async () => {
    const state = makeState();
    const deps = makeDeps(state);
    const res = await processDeletionRequest(baseJob(), deps);

    expect(res.done).toBe(true);
    expect(res.status).toBe("completed");
    expect(state.cancelled).toEqual([]);
    expect(state.events).toBe(1);
    // Minimisation at completion.
    expect(latest.user_id).toBeNull();
    expect(latest.recipient_email).toBeNull();
    expect(latest.completed_at).toBeTruthy();
  });

  it("cancels an owned live subscription before deleting the identity", async () => {
    const state = makeState({
      sub: { data: { stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", status: "active" }, error: false },
      ownership: { kind: "owned", customerId: "cus_1" },
    });
    const res = await processDeletionRequest(baseJob(), makeDeps(state));

    expect(res.status).toBe("completed");
    expect(state.cancelled).toEqual(["sub_1"]);
    expect(state.events).toBe(1);
  });

  it("clears a residual table by deleting then re-counting to zero", async () => {
    const registry: RegistryEntry[] = [{ table: "plans", column: "user_id", onDelete: "cascade" }];
    let calls = 0;
    const state = makeState({ registry });
    const deps = makeDeps(state);
    // First count > 0, re-count after delete == 0.
    deps.countRows = async () => {
      calls += 1;
      return { data: calls === 1 ? 3 : 0, error: false };
    };
    const res = await processDeletionRequest(baseJob(), deps);
    expect(res.status).toBe("completed");
  });
});

describe("processDeletionRequest — fail-closed billing", () => {
  it("fails closed when the subscription read errors, advancing nothing", async () => {
    const state = makeState({ sub: { data: null, error: true } });
    const res = await processDeletionRequest(baseJob(), makeDeps(state));

    expect(res.done).toBe(false);
    expect(res.status).toBe("requested");
    expect(res.errorCode).toBe("billing_unavailable");
    expect(state.persisted.at(-1)?.patch.last_error_code).toBe("billing_unavailable");
    expect(state.persisted.at(-1)?.patch.attempts).toBe(1);
  });

  it("never cancels/deletes over a customer that isn't proven Mellowa-owned", async () => {
    const state = makeState({
      sub: { data: { stripe_subscription_id: "sub_x", stripe_customer_id: "cus_foreign", status: "active" }, error: false },
      ownership: { kind: "mismatch" },
    });
    const res = await processDeletionRequest(baseJob(), makeDeps(state));

    expect(res.status).toBe("requested");
    expect(res.errorCode).toBe("billing_reconciliation_required");
    expect(state.cancelled).toEqual([]);
    expect(state.events).toBe(0);
  });

  it("fails closed when a live sub has no customer id to attribute", async () => {
    const state = makeState({
      sub: { data: { stripe_subscription_id: "sub_1", stripe_customer_id: null, status: "active" }, error: false },
    });
    const res = await processDeletionRequest(baseJob(), makeDeps(state));
    expect(res.errorCode).toBe("billing_reconciliation_required");
    expect(state.cancelled).toEqual([]);
  });

  it("aborts if an owned subscription cancel fails (does not delete identity)", async () => {
    const state = makeState({
      sub: { data: { stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", status: "active" }, error: false },
      ownership: { kind: "owned", customerId: "cus_1" },
      cancel: { ok: false, error: "cancel_failed" },
    });
    const res = await processDeletionRequest(baseJob(), makeDeps(state));
    expect(res.errorCode).toBe("billing_cancel_failed");
    expect(state.events).toBe(0);
  });

  it("tolerates an already-cancelled subscription", async () => {
    const state = makeState({
      sub: { data: { stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", status: "active" }, error: false },
      ownership: { kind: "owned", customerId: "cus_1" },
      cancel: { ok: false, alreadyGone: true },
    });
    const res = await processDeletionRequest(baseJob(), makeDeps(state));
    expect(res.status).toBe("completed");
  });

  it("treats a canceled subscription as nothing to cancel", async () => {
    const state = makeState({
      sub: { data: { stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", status: "canceled" }, error: false },
    });
    const res = await processDeletionRequest(baseJob(), makeDeps(state));
    expect(res.status).toBe("completed");
    expect(state.cancelled).toEqual([]);
  });
});

describe("processDeletionRequest — fail-closed auth + residuals", () => {
  it("fails closed on an ambiguous auth read (never claims deleted)", async () => {
    const state = makeState({
      del: { notFound: false },
      getUser: { present: false, error: true },
    });
    const res = await processDeletionRequest(baseJob({ status: "subscription_cancelled" }), makeDeps(state));
    expect(res.errorCode).toBe("auth_verify_unavailable");
    expect(res.status).toBe("subscription_cancelled");
  });

  it("fails when the identity is still present after delete", async () => {
    const state = makeState({ getUser: { present: true, error: false } });
    const res = await processDeletionRequest(baseJob({ status: "subscription_cancelled" }), makeDeps(state));
    expect(res.errorCode).toBe("auth_delete_unverified");
  });

  it("tolerates an already-gone identity (notFound)", async () => {
    const state = makeState({ del: { notFound: true }, getUser: { present: false, error: false } });
    const res = await processDeletionRequest(baseJob({ status: "subscription_cancelled" }), makeDeps(state));
    expect(res.status).toBe("completed");
  });

  it("fails when a residual table cannot be re-counted to zero", async () => {
    const registry: RegistryEntry[] = [{ table: "plans", column: "user_id", onDelete: "cascade" }];
    const state = makeState({ registry, counts: { plans: { data: 2, error: false } } });
    const res = await processDeletionRequest(baseJob({ status: "auth_deleted" }), makeDeps(state));
    // count stays 2 both times → not cleared.
    expect(res.errorCode).toBe("residual_not_cleared");
    // The residual table is recorded (in a persist just before the failing one).
    const recorded = state.persisted.some((p) => p.patch.residual_tables?.includes("plans"));
    expect(recorded).toBe(true);
  });

  it("fails closed when a residual count query errors", async () => {
    const registry: RegistryEntry[] = [{ table: "plans", column: "user_id", onDelete: "cascade" }];
    const state = makeState({ registry, counts: { plans: { data: null, error: true } } });
    const res = await processDeletionRequest(baseJob({ status: "auth_deleted" }), makeDeps(state));
    expect(res.errorCode).toBe("residual_query_error");
  });

  it("skips anonymize-only tables (FK ON DELETE SET NULL)", async () => {
    const registry: RegistryEntry[] = [{ table: "audit", column: "actor_id", onDelete: "anonymize" }];
    const state = makeState({ registry, counts: { audit: { data: 99, error: false } } });
    const res = await processDeletionRequest(baseJob({ status: "auth_deleted" }), makeDeps(state));
    expect(res.status).toBe("completed");
  });
});

describe("processDeletionRequest — notification + resumability", () => {
  it("records notification_not_queued but still completes", async () => {
    const state = makeState({ queued: { queued: false } });
    const res = await processDeletionRequest(baseJob({ status: "data_verified" }), makeDeps(state));
    expect(res.status).toBe("completed");
    const notif = state.persisted.find((p) => p.patch.status === "notification_queued");
    expect(notif?.patch.last_error_code).toBe("notification_not_queued");
  });

  it("a resumed job at notification_queued only records the event once", async () => {
    const state = makeState();
    const res = await processDeletionRequest(
      baseJob({ status: "notification_queued", recipient_email: null }),
      makeDeps(state)
    );
    expect(res.status).toBe("completed");
    expect(state.events).toBe(1);
  });

  it("fails a non-completed job that lost its user id", async () => {
    const state = makeState();
    const res = await processDeletionRequest(baseJob({ user_id: null }), makeDeps(state));
    expect(res.errorCode).toBe("missing_user_id");
    expect(res.done).toBe(false);
  });

  it("an already-completed job is a no-op", async () => {
    const state = makeState();
    const res = await processDeletionRequest(baseJob({ status: "completed", user_id: null }), makeDeps(state));
    expect(res.done).toBe(true);
    expect(state.events).toBe(0);
    expect(state.persisted).toEqual([]);
  });
});

describe("deletionBackoffMinutes", () => {
  it("grows roughly exponentially and caps at 60", () => {
    const fixed = () => 0.5; // no jitter
    expect(deletionBackoffMinutes(1, fixed)).toBe(2);
    expect(deletionBackoffMinutes(2, fixed)).toBe(4);
    expect(deletionBackoffMinutes(3, fixed)).toBe(8);
    expect(deletionBackoffMinutes(20, fixed)).toBe(60);
  });

  it("never returns less than 1 minute", () => {
    expect(deletionBackoffMinutes(0, () => 0)).toBeGreaterThanOrEqual(1);
  });
});
