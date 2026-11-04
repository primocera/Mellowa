import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Support console hardening:
 *  - the role matrix (lib/admin/permissions.ts) is ENFORCED by the admin
 *    mutation routes, with the role derived from ADMIN_ROLES (lib/admin/auth.ts);
 *  - isGenerationDisabled fails closed on a read error;
 *  - the email lookup resolves the AUTH email exactly, never a LIKE pattern on
 *    the user-editable profiles.email, and never picks an ambiguous match;
 *  - consents are read from the real column (consent_type) and a read error is
 *    "couldn't load", not "none".
 */

type Row = Record<string, unknown>;

const OWNER = "00000000-0000-4000-8000-000000000001";
const OPERATOR = "00000000-0000-4000-8000-000000000002";
const VIEWER = "00000000-0000-4000-8000-000000000003";
const TARGET = "00000000-0000-4000-8000-0000000000aa";

const h = vi.hoisted(() => ({
  sessionUserId: null as string | null,
  writes: [] as Array<{ table: string; op: string; row: unknown }>,
  audit: [] as Row[],
  // account_flags read used by isGenerationDisabled
  flagsRead: { data: null as Row | null, error: null as Row | null },
  flagsThrows: false,
  // lookup fixtures
  profileRows: [] as Array<{ id: string }>,
  profileError: null as Row | null,
  profileEqCalls: [] as Array<[string, unknown]>,
  authUsers: {} as Record<string, { id: string; email: string }>,
  listError: null as Row | null,
  // overview fixtures
  consentsRes: { data: [] as Row[] | null, error: null as Row | null },
  consentSelect: "",
  backfillRuns: [] as Array<{ dryRun: boolean }>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: h.sessionUserId ? { id: h.sessionUserId } : null } }),
    },
  }),
}));

function thenable<T>(value: T) {
  return {
    then: (resolve: (v: T) => unknown) => Promise.resolve(value).then(resolve),
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (h.flagsThrows) throw new Error("boom");
    return {
      auth: {
        admin: {
          getUserById: async (id: string) => {
            const u = h.authUsers[id];
            return u
              ? { data: { user: { ...u, created_at: "2026-01-01", email_confirmed_at: "x" } }, error: null }
              : { data: { user: null }, error: { status: 404 } };
          },
          listUsers: async ({ page }: { page: number }) => {
            if (h.listError) return { data: { users: [] }, error: h.listError };
            return { data: { users: page === 1 ? Object.values(h.authUsers) : [] }, error: null };
          },
        },
        resend: async () => ({ error: null }),
      },
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        chain.select = (cols: string) => {
          if (table === "user_consents") h.consentSelect = cols;
          return chain;
        };
        chain.eq = (col: string, val: unknown) => {
          if (table === "profiles") h.profileEqCalls.push([col, val]);
          return chain;
        };
        chain.ilike = () => {
          throw new Error("ilike must not be used for the support lookup");
        };
        chain.order = self;
        chain.in = self;
        chain.limit = () => {
          if (table === "profiles") return thenable({ data: h.profileRows, error: h.profileError });
          if (table === "user_consents") return thenable(h.consentsRes);
          return thenable({ data: [], error: null });
        };
        chain.maybeSingle = async () => {
          if (table === "account_flags") return h.flagsRead;
          return { data: null, error: null };
        };
        chain.upsert = (row: unknown) => {
          h.writes.push({ table, op: "upsert", row });
          return Promise.resolve({ error: null });
        };
        chain.update = (row: unknown) => {
          h.writes.push({ table, op: "update", row });
          return { eq: () => ({ in: () => ({ select: async () => ({ data: [], error: null }) }) }) };
        };
        chain.insert = async (row: Row) => {
          if (table === "admin_audit_log") h.audit.push(row);
          else h.writes.push({ table, op: "insert", row });
          return { error: null };
        };
        return chain;
      },
    };
  },
}));

vi.mock("@/lib/onboarding/backfill", () => ({
  runOnboardingBackfill: async (_deps: unknown, opts: { dryRun: boolean }) => {
    h.backfillRuns.push(opts);
    return { definitionVersion: "v1", backfilled: 0, skippedPartial: 0, failed: 0, dryRun: opts.dryRun };
  },
}));

import { POST as userActions } from "@/app/api/admin/user-actions/route";
import {
  GET as backfillGet,
  POST as backfillPost,
} from "@/app/api/admin/onboarding-backfill/route";
import { adminRoleFor, parseAdminRoles, DEFAULT_ADMIN_ROLE } from "@/lib/admin/auth";
import {
  getUserOverview,
  isGenerationDisabled,
  lookupUserByEmail,
} from "@/lib/admin/support";

function post(url: string, body: unknown) {
  return new Request(url, { method: "POST", body: JSON.stringify(body) });
}
const actionReq = (body: Row) => post("http://t/api/admin/user-actions", body);

beforeEach(() => {
  process.env.ADMIN_USER_IDS = [OWNER, OPERATOR, VIEWER].join(",");
  process.env.ADMIN_ROLES = `${OWNER}:owner,${VIEWER}:viewer`;
  h.sessionUserId = OPERATOR;
  h.writes = [];
  h.audit = [];
  h.flagsRead = { data: null, error: null };
  h.flagsThrows = false;
  h.profileRows = [];
  h.profileError = null;
  h.profileEqCalls = [];
  h.authUsers = {};
  h.listError = null;
  h.consentsRes = { data: [], error: null };
  h.consentSelect = "";
  h.backfillRuns = [];
});

describe("admin role resolution (ADMIN_ROLES)", () => {
  it("an admin without an explicit role gets the operator default; ids must still be admins", () => {
    expect(DEFAULT_ADMIN_ROLE).toBe("operator");
    expect(adminRoleFor(OPERATOR)).toBe("operator");
    expect(adminRoleFor(OWNER)).toBe("owner");
    expect(adminRoleFor(VIEWER)).toBe("viewer");
    // A role entry never grants admin on its own.
    process.env.ADMIN_ROLES = `${TARGET}:owner`;
    expect(adminRoleFor(TARGET)).toBeNull();
    expect(adminRoleFor(null)).toBeNull();
  });

  it("an unknown/typo role fails closed to viewer, and duplicates keep the least privilege", () => {
    const roles = parseAdminRoles(`a:superuser, b:owner, b:viewer, c:Owner, :owner, junk`);
    expect(roles.get("a")).toBe("viewer");
    expect(roles.get("b")).toBe("viewer");
    expect(roles.get("c")).toBe("owner");
    expect(roles.size).toBe(3);
  });
});

describe("POST /api/admin/user-actions enforces checkPermission", () => {
  it("404 for a non-admin", async () => {
    h.sessionUserId = TARGET;
    const res = await userActions(actionReq({ action: "view_user", target_user_id: TARGET, reason: "look" }));
    expect(res.status).toBe(404);
  });

  it("a viewer is denied a destructive action (403 insufficient_role) and nothing changes", async () => {
    h.sessionUserId = VIEWER;
    const res = await userActions(
      actionReq({ action: "disable_generation", target_user_id: TARGET, reason: "abuse", step_up_confirmed: true })
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("insufficient_role");
    expect(h.writes).toEqual([]);
    expect(h.audit).toEqual([]);
  });

  it("a viewer may still record a read (view_user)", async () => {
    h.sessionUserId = VIEWER;
    const res = await userActions(actionReq({ action: "view_user", target_user_id: TARGET, reason: "look" }));
    expect(res.status).toBe(200);
    expect(h.audit).toHaveLength(1);
  });

  it("a destructive action without step-up is denied (403 step_up_required)", async () => {
    const res = await userActions(
      actionReq({ action: "flag_billing_review", target_user_id: TARGET, reason: "chargeback" })
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("step_up_required");
    expect(h.writes).toEqual([]);
  });

  it("an operator with reason + step-up is allowed, the change is written and audited", async () => {
    const res = await userActions(
      actionReq({ action: "disable_generation", target_user_id: TARGET, reason: "abuse", step_up_confirmed: true })
    );
    expect(res.status).toBe(200);
    expect(h.writes).toEqual([
      expect.objectContaining({ table: "account_flags", op: "upsert" }),
    ]);
    expect(h.audit).toEqual([expect.objectContaining({ action: "disable_generation", actor_user_id: OPERATOR })]);
  });
});

describe("onboarding backfill is an owner-only, step-up data job", () => {
  it("GET never writes: ?dryRun=0 is refused (405) and a plain GET is a dry run", async () => {
    h.sessionUserId = OWNER;
    const refused = await backfillGet(new Request("http://t/api/admin/onboarding-backfill?dryRun=0"));
    expect(refused.status).toBe(405);
    const dry = await backfillGet(new Request("http://t/api/admin/onboarding-backfill"));
    expect(dry.status).toBe(200);
    expect(h.backfillRuns).toEqual([{ dryRun: true }]);
  });

  it("an operator (default role) is denied a real run", async () => {
    const res = await backfillPost(post("http://t/x", { reason: "legacy", step_up_confirmed: true }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("insufficient_role");
    expect(h.backfillRuns).toEqual([]);
  });

  it("an owner without reason/step-up is denied; with both the run happens and is audited", async () => {
    h.sessionUserId = OWNER;
    const noStep = await backfillPost(post("http://t/x", { reason: "legacy accounts" }));
    expect(noStep.status).toBe(403);
    expect((await noStep.json()).error).toBe("step_up_required");
    const empty = await backfillPost(new Request("http://t/x", { method: "POST" }));
    expect(empty.status).toBe(403);
    expect((await empty.json()).error).toBe("reason_required");
    expect(h.backfillRuns).toEqual([]);

    const ok = await backfillPost(post("http://t/x", { reason: "legacy accounts", step_up_confirmed: true }));
    expect(ok.status).toBe(200);
    expect(h.backfillRuns).toEqual([{ dryRun: false }]);
    expect(h.audit).toEqual([expect.objectContaining({ action: "onboarding_backfill" })]);
  });

  it("an operator may still dry-run via POST", async () => {
    const res = await backfillPost(post("http://t/x", { dryRun: true }));
    expect(res.status).toBe(200);
    expect(h.backfillRuns).toEqual([{ dryRun: true }]);
  });
});

describe("isGenerationDisabled fails closed", () => {
  it("returns true when the flag read errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.flagsRead = { data: null, error: { code: "57014" } };
    expect(await isGenerationDisabled(TARGET)).toBe(true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns true when the client throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.flagsThrows = true;
    expect(await isGenerationDisabled(TARGET)).toBe(true);
    spy.mockRestore();
  });

  it("reflects the stored flag on a clean read (no row = enabled)", async () => {
    h.flagsRead = { data: { generation_disabled: true }, error: null };
    expect(await isGenerationDisabled(TARGET)).toBe(true);
    h.flagsRead = { data: null, error: null };
    expect(await isGenerationDisabled(TARGET)).toBe(false);
  });
});

describe("support lookup resolves the auth email exactly", () => {
  it("uses an exact, normalized match (no LIKE wildcards) and confirms against auth", async () => {
    h.authUsers = { [TARGET]: { id: TARGET, email: "person@example.com" } };
    h.profileRows = [{ id: TARGET }];
    expect(await lookupUserByEmail("  Person@Example.com ")).toEqual({ status: "found", userId: TARGET });
    expect(h.profileEqCalls).toEqual([["email", "person@example.com"]]);
  });

  it("a wildcard-looking address matches nothing rather than someone else", async () => {
    h.authUsers = { [TARGET]: { id: TARGET, email: "person@example.com" } };
    expect(await lookupUserByEmail("%@example.com")).toEqual({ status: "not_found" });
    expect(await lookupUserByEmail("p_rson@example.com")).toEqual({ status: "not_found" });
  });

  it("a profile email spoofed to the victim's address is NOT trusted; the real auth owner is found", async () => {
    const ATTACKER = "00000000-0000-4000-8000-0000000000bb";
    h.authUsers = {
      [ATTACKER]: { id: ATTACKER, email: "attacker@example.com" },
      [TARGET]: { id: TARGET, email: "victim@example.com" },
    };
    // The attacker edited their profiles.email to the victim's address.
    h.profileRows = [{ id: ATTACKER }];
    expect(await lookupUserByEmail("victim@example.com")).toEqual({ status: "found", userId: TARGET });
  });

  it("more than one confirmed match is ambiguous — never pick one", async () => {
    const OTHER = "00000000-0000-4000-8000-0000000000cc";
    h.authUsers = {
      [TARGET]: { id: TARGET, email: "dup@example.com" },
      [OTHER]: { id: OTHER, email: "DUP@example.com" },
    };
    expect(await lookupUserByEmail("dup@example.com")).toEqual({ status: "ambiguous" });
  });

  it("a read error is unavailable, not 'no account'", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.profileError = { code: "500" };
    expect(await lookupUserByEmail("person@example.com")).toEqual({ status: "unavailable" });
    h.profileError = null;
    h.listError = { status: 500 };
    expect(await lookupUserByEmail("person@example.com")).toEqual({ status: "unavailable" });
    spy.mockRestore();
  });
});

describe("support overview consents", () => {
  beforeEach(() => {
    h.authUsers = { [TARGET]: { id: TARGET, email: "person@example.com" } };
  });

  it("selects the real consent_type column and maps it", async () => {
    h.consentsRes = {
      data: [{ consent_type: "privacy", version: "2026-10", granted: true, created_at: "2026-10-02T00:00:00Z" }],
      error: null,
    };
    const o = await getUserOverview(TARGET);
    expect(h.consentSelect).toContain("consent_type");
    expect(h.consentSelect).not.toMatch(/\bkind\b/);
    expect(o?.consents).toEqual([
      { consentType: "privacy", version: "2026-10", granted: true, createdAt: "2026-10-02T00:00:00Z" },
    ]);
  });

  it("a consents read error surfaces as null (couldn't load), not an empty list", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.consentsRes = { data: null, error: { code: "42703" } };
    const o = await getUserOverview(TARGET);
    expect(o?.consents).toBeNull();
    spy.mockRestore();
  });
});
