import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One-click unsubscribe writes to the state the scheduler reads (MW-V11-10).
 *
 * This file exists because the route had been writing to the wrong table since
 * it was introduced, and nothing noticed. `unsubscribe()` updated
 * `profiles` keyed by `id`, while every reminder column lives on
 * `wellbeing_profiles` keyed by `user_id`. `public.profiles` has five columns —
 * id, email, full_name, created_at, updated_at — so the update did not merely
 * target the wrong row, it named columns that do not exist. PostgREST rejected
 * it, the route returned its failure page, and the scheduler's view of the
 * user's consent never changed.
 *
 * The whole suite was green throughout. It was green because no test asserted
 * the one thing that matters about an unsubscribe: that the write lands where
 * the read looks. A test that mocks the client and only checks "did we call
 * update" would have stayed green too — so these assert the table and the key
 * column by name, and pin them to what the cron actually queries.
 */

const updateMock = vi.fn();
const eqMock = vi.fn();
/** Every `from(...)` the route makes, in order. */
const fromCalls: string[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      fromCalls.push(table);
      return {
        update: (patch: Record<string, unknown>) => {
          updateMock(patch);
          return {
            eq: (column: string, value: unknown) => {
              eqMock(column, value);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  }),
}));

import { GET, POST } from "@/app/api/email/unsubscribe/route";
import { unsubscribeToken } from "@/lib/email/unsubscribe";

/** The route signs with EMAIL_UNSUBSCRIBE_SECRET, falling back to CRON_SECRET. */
process.env.EMAIL_UNSUBSCRIBE_SECRET = "test-unsubscribe-secret";

const USER = "11111111-2222-3333-4444-555555555555";

/** The columns the daily-reminders cron selects and filters on. */
const CRON_TABLE = "wellbeing_profiles";
const CRON_KEY = "user_id";

function url(category: string, token: string | null) {
  return new URL(
    `https://mellowa.app/api/email/unsubscribe?u=${USER}&c=${category}&t=${token ?? ""}`,
  );
}

function request(category: string, token: string | null) {
  return new Request(url(category, token));
}

beforeEach(() => {
  updateMock.mockClear();
  eqMock.mockClear();
  fromCalls.length = 0;
});

describe("one-click unsubscribe reaches the scheduler's state", () => {
  it("updates the table the cron reads, keyed by the column the cron uses", async () => {
    const token = unsubscribeToken(USER, "daily_reminder")!;
    const res = await POST(request("daily_reminder", token));

    expect(res.status).toBe(200);
    // The regression: `profiles`/`id` instead of `wellbeing_profiles`/`user_id`.
    expect(fromCalls).toEqual([CRON_TABLE]);
    expect(eqMock).toHaveBeenCalledWith(CRON_KEY, USER);
  });

  it("clears the consent flag the cron filters on, not just the send time", async () => {
    const token = unsubscribeToken(USER, "daily_reminder")!;
    await POST(request("daily_reminder", token));

    const patch = updateMock.mock.calls[0][0];
    // The cron scans `.eq("reminders_opt_in", true)`. Leaving that true and
    // relying on a null reminder_time would work only for as long as nothing
    // else ever sets a time again.
    expect(patch).toMatchObject({
      reminders_opt_in: false,
      reminders_paused: true,
      reminder_time: null,
    });
  });

  it("only writes columns that exist on that table", async () => {
    const token = unsubscribeToken(USER, "daily_reminder")!;
    await POST(request("daily_reminder", token));

    // Named explicitly: the original defect was a write to columns that were
    // never on the target table, and a mock that accepts anything hides that.
    const allowed = new Set([
      "reminders_opt_in",
      "reminders_paused",
      "reminder_time",
      "reminder_skip_date",
      "reminder_consent_version",
    ]);
    for (const column of Object.keys(updateMock.mock.calls[0][0])) {
      expect(allowed, `"${column}" is not a wellbeing_profiles reminder column`)
        .toContain(column);
    }
  });

  it("honours the other reminder category the same way", async () => {
    const token = unsubscribeToken(USER, "onboarding_nudge")!;
    const res = await POST(request("onboarding_nudge", token));

    expect(res.status).toBe(200);
    expect(fromCalls).toEqual([CRON_TABLE]);
    expect(eqMock).toHaveBeenCalledWith(CRON_KEY, USER);
  });

  it("works on GET too — some clients follow the link rather than POST it", async () => {
    const token = unsubscribeToken(USER, "daily_reminder")!;
    const res = await GET(request("daily_reminder", token));

    expect(res.status).toBe(200);
    expect(fromCalls).toEqual([CRON_TABLE]);
  });
});

describe("a forged or malformed link changes nothing", () => {
  it("rejects a bad token without touching the database", async () => {
    const res = await POST(request("daily_reminder", "not-a-real-token"));

    expect(res.status).not.toBe(200);
    expect(fromCalls).toEqual([]);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects a token minted for a different category", async () => {
    // A nudge token must not switch off daily reminders.
    const token = unsubscribeToken(USER, "onboarding_nudge")!;
    const res = await POST(request("daily_reminder", token));

    expect(res.status).not.toBe(200);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown category", async () => {
    const token = unsubscribeToken(USER, "daily_reminder")!;
    const res = await POST(request("billing_receipt", token));

    // Transactional billing mail is deliberately not unsubscribable.
    expect(res.status).not.toBe(200);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
