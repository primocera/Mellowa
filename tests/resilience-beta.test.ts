import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * MW-V11-07: operational resilience drill and capped-beta scorecard.
 *
 * Both artifacts here are documents the owner executes, so what can be tested
 * is whether they are executable and honest — the same contract the rehearsal
 * runbooks are held to in `rehearsal-readiness.test.ts`.
 *
 * The specific failures being guarded against:
 *  - a restore drill that proves "the app loaded" and nothing about whether the
 *    safety-critical and consent data survived;
 *  - a desired RTO presented as if it were a measured one;
 *  - a beta scorecard whose thresholds could be written after seeing the data;
 *  - a small-cohort percentage reported without its denominator, which is how
 *    two people become "50% conversion".
 */

const flat = (source: string) => source.replace(/\s+/g, " ");

/**
 * Read a document and refuse to proceed on an empty one.
 *
 * Several assertions in this file check that a document does NOT contain
 * something. An empty string satisfies every one of them, so a read that
 * silently returned nothing would turn this suite green while checking
 * nothing — the exact false-green shape v11 has been removing everywhere else.
 * Worth guarding because `P2-SUITE-FLAKES` shows these doc-scanning tests
 * occasionally misbehave under full-suite load.
 */
function readDoc(path: string): string {
  const contents = readFileSync(path, "utf8");
  if (contents.trim().length < 200) {
    throw new Error(
      `${path} read as ${contents.length} chars — refusing to assert against an empty document`
    );
  }
  return flat(contents);
}

const rotation = readDoc("docs/runbooks/key-rotation-and-backup.md");
const scorecard = readDoc("docs/beta-scorecard.md");
const research = readDoc("docs/beta-research.md");

describe("the rotation and restore drill is executable", () => {
  it("points at the current scorecard and its blocker", () => {
    expect(rotation).toContain("P1-ROTATION-RESTORE");
    expect(rotation).toContain("launch-go-no-go-v11.md");
  });

  it("rehearses on a scratch project, never on production", () => {
    expect(rotation).toMatch(/separate project.*never on production/i);
  });

  it("verifies what survived, not just that the app came up", () => {
    for (const check of [
      /row counts per user-owned table/i,
      /still resolves to an auth user/i,
      /reminder_consent_version/i,
      /allergy and dietary fields/i,
      /subscriptions.*map to the same Stripe ids/i,
      /deletion tombstones/i,
    ]) {
      expect(rotation, `restore verification is missing ${check}`).toMatch(check);
    }
  });

  it("keeps tested RTO separate from desired RTO", () => {
    expect(rotation).toMatch(/RTO and RPO — tested versus desired/i);
    expect(rotation).toMatch(/Until the Tested column is filled, this project has no RTO or RPO/i);
  });

  it("names what a database restore does not bring back", () => {
    expect(rotation).toMatch(/What is not in the backup/i);
    // Stripe is the one that bites: the DB can restore into disagreement with
    // the payment processor, and only reconciliation resolves it.
    expect(rotation).toMatch(/Stripe objects/i);
    expect(rotation).toMatch(/suppression lists/i);
  });

  it("treats a restore over a deletion as an incident, not a rollback", () => {
    expect(rotation).toMatch(/reinstates data the user asked to remove/i);
    expect(rotation).toMatch(/re-apply deletions/i);
  });

  it("forbids writing any secret value into the evidence", () => {
    expect(rotation).toMatch(/never write a secret value into this file/i);
    expect(rotation).toMatch(/still a key in git history/i);
  });

  it("contains no secret-shaped string itself", () => {
    const raw = readFileSync("docs/runbooks/key-rotation-and-backup.md", "utf8");
    for (const pattern of [/sk_live_[A-Za-z0-9]{8,}/, /whsec_[A-Za-z0-9]{8,}/, /\bey[A-Za-z0-9_-]{20,}\./]) {
      expect(raw, `the runbook contains something shaped like a real secret`).not.toMatch(pattern);
    }
  });
});

describe("every secret has its own rotation procedure (MW-V12-05)", () => {
  it("names all of them, including the two the v11 runbook lumped together", () => {
    for (const secret of [
      "CRON_SECRET",
      "ADMIN_STATS_SECRET",
      "RESEND_API_KEY",
      "AI_PROVIDER_API_KEY",
      // Split apart: the Stripe API key and the webhook signing secret rotate
      // differently and break different things.
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "SUPABASE_SERVICE_ROLE_KEY",
      // The application signing secret the v11 runbook omitted entirely.
      "EMAIL_UNSUBSCRIBE_SECRET",
    ]) {
      expect(rotation, `no rotation procedure for ${secret}`).toContain(secret);
    }
  });

  it("gives each secret an owner and a stated overlap window", () => {
    expect(rotation).toMatch(/\| Owner \|/);
    expect(rotation).toMatch(/can old \+ new both be valid\?/i);
    // The no-overlap secrets must be called out as such, not silently rotated.
    expect(rotation).toMatch(/HMAC verifies one key/i);
  });

  it("states preconditions and a rollback for every rotation", () => {
    expect(rotation).toMatch(/Preconditions for every rotation/i);
    expect(rotation).toMatch(/roll back by reverting the Vercel variable/i);
  });
});

describe("rotation is verifiable without printing a secret (MW-V12-05)", () => {
  const script = readFileSync("scripts/secret-fingerprint.mjs", "utf8");

  it("the runbook verifies IDENTITY via a fingerprint, not just presence", () => {
    expect(rotation).toMatch(/secret-fingerprint\.mjs/);
    expect(rotation).toMatch(/fingerprint.*changed.*after the rotation/i);
  });

  it("the fingerprint is one-way and truncated", () => {
    expect(script).toMatch(/createHash\("sha256"\)/);
    // 12 hex = 48 bits: enough to compare, not enough to attack.
    expect(script).toContain("FINGERPRINT_HEX = 12");
    expect(script).toMatch(/\.slice\(0, FINGERPRINT_HEX\)/);
  });

  it("never prints the value, a prefix or a suffix", () => {
    expect(script).toMatch(/never prints the value/i);
    // No slice/substr of the raw secret — only the HASH is truncated.
    expect(script).not.toMatch(/value\.slice\(/);
    expect(script).not.toMatch(/value\.substr/);
    // The leak vector in a template literal is interpolating the value itself.
    // The only permitted interpolations are ${fingerprint(value)} and
    // ${value.length}: a raw ${value} or any ${value.<other>} would expose it.
    expect(script, "raw value is interpolated into output").not.toMatch(/\$\{value\}/);
    expect(script, "a value property other than length is interpolated").not.toMatch(
      /\$\{\s*value\.(?!length)/,
    );
  });
});

describe("the restore checklist is executable, not eyeballed (MW-V12-05)", () => {
  const sqlRaw = readFileSync("docs/runbooks/restore-verification.sql", "utf8");
  const sql = sqlRaw.toLowerCase();

  it("the runbook points at the read-only verification script", () => {
    expect(rotation).toMatch(/restore-verification\.sql/);
  });

  it("is strictly read-only — no statement can mutate the scratch database", () => {
    for (const mutation of [
      /\binsert\s+into\b/,
      /\bupdate\s+\w+\s+set\b/,
      /\bdelete\s+from\b/,
      /\bdrop\s+/,
      /\bcreate\s+/,
      /\balter\s+/,
      /\btruncate\b/,
    ]) {
      expect(sql, `the verification SQL contains a mutating statement ${mutation}`).not.toMatch(
        mutation,
      );
    }
    expect(sql).toContain("select");
  });

  it("covers every row of the restore-verification checklist", () => {
    for (const check of [
      /count\(\*\)/, // 1 row counts
      /left join auth\.users/, // 2 orphaned owners
      /reminder_consent_version/, // 3 consent
      /allergies/, // 4 safety fields
      /stripe_customer_id/, // 5 stripe mapping
      /auth_users_in_restore/, // 6 tombstone/resurrection diff
      /sections = '\{\}'::jsonb/, // 7 version snapshots
    ]) {
      expect(sql, `the verification SQL is missing ${check}`).toMatch(check);
    }
  });
});

describe("the beta scorecard can actually decide something", () => {
  it("caps the beta at 50 and says what enforces it", () => {
    expect(scorecard).toMatch(/Maximum beta accounts \| \*\*50\*\*/);
    expect(scorecard).toMatch(/Database trigger, migration `039`/);
    // A form check is not a cap when signup goes straight to Supabase.
    expect(scorecard).toMatch(/not a form check/i);
  });

  it("declares thresholds before the data exists, and says why", () => {
    expect(scorecard).toMatch(/a threshold chosen after seeing the number is not a decision/i);
  });

  it("separates no-data from zero", () => {
    // Conflating them is how a beta talks itself into expanding.
    expect(scorecard).toMatch(/Cohort under 5 → `—` \(no data\)/);
    expect(scorecard).toMatch(/Not 0%/);
    expect(scorecard).toMatch(/No data and below-threshold are different states/i);
  });

  it("gives every metric a numerator, denominator and window", () => {
    expect(scorecard).toMatch(/Numerator \/ denominator/);
    expect(scorecard).toMatch(/\| Window \|/);
  });

  it("refuses a bare percentage on a tiny denominator", () => {
    expect(scorecard).toMatch(/must be written as "2 of 4", never as a percentage alone/i);
  });

  it("covers the whole loop from sample to renewal", () => {
    for (const metric of [
      /Sample completion/i,
      /Day-2 return/i,
      /Day-3 return/i,
      /Adjust preview opened/i,
      /Adjust applied/i,
      /Week opened/i,
      /Carry-forward used/i,
      /Trial start/i,
      /Trial → charge/i,
      /Renewal/i,
      /Refund or dispute rate/i,
    ]) {
      expect(scorecard, `the scorecard never measures ${metric}`).toMatch(metric);
    }
  });

  it("does not treat Undo as a metric to drive down", () => {
    // High Undo may mean the feature is trusted enough to experiment with.
    expect(scorecard).toMatch(/No threshold — observed only/);
    expect(scorecard).toMatch(/never optimise it down/i);
  });

  it("measures support cost without turning safety contacts into a target", () => {
    expect(scorecard).toMatch(/Support contacts per active account/i);
    expect(scorecard).toMatch(/Never a metric to optimise/i);
  });

  it("renders unknown cost as unknown, never as zero", () => {
    expect(scorecard).toMatch(/`null` renders as "unknown", never `\$0\.00`/);
  });

  it("freezes broad feature work during the beta", () => {
    expect(scorecard).toMatch(/Freeze rule/i);
    expect(scorecard).toMatch(/P1 barrier reported by more than one participant/i);
    expect(scorecard).toMatch(/only learns that the team is busy/i);
  });

  it("makes BLOCKED the default expansion verdict", () => {
    expect(scorecard).toMatch(/Missing any one of these means \*\*BLOCKED\*\*, and blocked is the default/i);
    expect(scorecard).toMatch(/cannot happen by momentum/i);
  });

  it("never asks a clinical question in an interview", () => {
    expect(scorecard).toMatch(/non-clinical/i);
    expect(scorecard).toMatch(/never ask about mood, symptoms or health outcomes/i);
    // Cancellation research must never become a retention obstacle.
    expect(scorecard).toMatch(/Cancellation is never delayed, gated or made contingent/i);
  });
});

describe("the scorecard and the research doc agree", () => {
  it("both defer to the same hard stop criteria", () => {
    expect(research).toMatch(/Hard stop criteria/i);
    expect(scorecard).toMatch(/hard-stop criterion from `docs\/beta-research\.md`/);
  });

  it("neither invents a second beta cap", () => {
    // Two documents naming different caps would make the trigger the only real
    // one and the docs decorative.
    const caps = (scorecard.match(/\b(\d{2,3}) (?:beta )?(?:accounts|invites|users)\b/gi) ?? [])
      .map((m) => m.match(/\d+/)![0])
      .filter((n) => n !== "5");
    for (const cap of caps) expect(cap).toBe("50");
  });
});
