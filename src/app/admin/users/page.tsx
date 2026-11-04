import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdminWithRole } from "@/lib/admin/auth";
import { ADMIN_ACTION_POLICY } from "@/lib/admin/permissions";
import {
  lookupUserByEmail,
  getUserOverview,
  recordAdminAction,
} from "@/lib/admin/support";
import { UserActions } from "./user-actions";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

/**
 * Support console (Launch v6, Prompt 17). Admin-only (Supabase session +
 * ADMIN_USER_IDS; non-admins get 404). Shows only safe metadata — never
 * journal text, check-in notes, allergies, mood values or generated content.
 * Every lookup is audited.
 *
 * Lookup resolves the AUTH email exactly (never the user-editable profiles
 * email, never a LIKE pattern); an ambiguous or unverifiable lookup shows no
 * account rather than risk showing the wrong one.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const caller = await requireAdminWithRole();
  if (!caller) notFound();
  const adminId = caller.id;

  const { email } = await searchParams;
  const lookup = email ? await lookupUserByEmail(email) : null;
  const userId = lookup?.status === "found" ? lookup.userId : null;
  const overview = userId ? await getUserOverview(userId) : null;

  if (userId && overview) {
    await recordAdminAction({
      actorUserId: adminId,
      action: "view_user",
      targetUserId: userId,
      reason: "support console lookup",
    });
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 text-[#1F2937]">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Support console</h1>
        <Link href="/admin" className="text-sm text-[#6D8C7D] underline">
          ← Metrics
        </Link>
      </div>

      <form method="GET" className="mb-8 flex gap-2">
        <input
          type="email"
          name="email"
          defaultValue={email ?? ""}
          placeholder="user@example.com"
          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2"
          required
        />
        <button className="rounded-xl bg-[#6D8C7D] px-4 py-2 text-white">
          Look up
        </button>
      </form>

      {email && !overview && (
        <p className="text-sm text-[#6B7280]" role="status">
          {lookup?.status === "ambiguous"
            ? `More than one account matches ${email}, so none is shown. Look the account up by its exact sign-in address.`
            : lookup?.status === "unavailable"
              ? "The lookup couldn't be completed just now. Please try again in a moment."
              : `No account found for ${email}.`}
        </p>
      )}

      {overview && (
        <div className="space-y-6">
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-2 font-medium">Account</h2>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-[#6B7280]">User id</dt>
              <dd className="break-all">{overview.account.id}</dd>
              <dt className="text-[#6B7280]">Email</dt>
              <dd>{overview.account.email}</dd>
              <dt className="text-[#6B7280]">Verified</dt>
              <dd>{overview.account.emailVerified ? "yes" : "no"}</dd>
              <dt className="text-[#6B7280]">Created</dt>
              <dd>{overview.account.createdAt?.slice(0, 10)}</dd>
              <dt className="text-[#6B7280]">Last sign-in</dt>
              <dd>{overview.account.lastSignInAt?.slice(0, 16) ?? "—"}</dd>
              <dt className="text-[#6B7280]">Flags</dt>
              <dd>
                {overview.flags.billingReview && "billing review "}
                {overview.flags.generationDisabled && "generation disabled"}
                {!overview.flags.billingReview && !overview.flags.generationDisabled && "none"}
              </dd>
            </dl>
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-2 font-medium">Subscription</h2>
            {overview.subscription ? (
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-[#6B7280]">Status</dt>
                <dd>{overview.subscription.status}</dd>
                <dt className="text-[#6B7280]">Plan</dt>
                <dd>{overview.subscription.planName ?? "—"}</dd>
                <dt className="text-[#6B7280]">Trial ends</dt>
                <dd>{overview.subscription.trialEnd?.slice(0, 10) ?? "—"}</dd>
                <dt className="text-[#6B7280]">Period ends</dt>
                <dd>{overview.subscription.currentPeriodEnd?.slice(0, 10) ?? "—"}</dd>
                <dt className="text-[#6B7280]">Stripe customer</dt>
                <dd>
                  {overview.subscription.stripeCustomerId ? (
                    <a
                      className="text-[#6D8C7D] underline"
                      href={`https://dashboard.stripe.com/customers/${overview.subscription.stripeCustomerId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      open in Stripe
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </dl>
            ) : (
              <p className="text-sm text-[#6B7280]">No subscription row.</p>
            )}
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-2 font-medium">Consents</h2>
            {overview.consents === null ? (
              <p className="text-sm text-[#991B1B]" role="status">
                Couldn&apos;t load consents just now — this is not the same as none recorded.
              </p>
            ) : (
              <ul className="text-sm">
                {overview.consents.map((c, i) => (
                  <li key={i}>
                    {c.consentType} v{c.version}
                    {!c.granted && " (withdrawn)"} — {c.createdAt.slice(0, 10)}
                  </li>
                ))}
                {!overview.consents.length && <li className="text-[#6B7280]">none recorded</li>}
              </ul>
            )}
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-2 font-medium">Email deliveries (last 20)</h2>
            <ul className="space-y-1 text-sm">
              {overview.emailDeliveries.map((e, i) => (
                <li key={i}>
                  {e.createdAt.slice(0, 16)} · {e.template} · <b>{e.status}</b>
                  {e.attempts > 1 && ` (${e.attempts} attempts)`}
                  {e.lastError && <span className="text-red-600"> — {e.lastError}</span>}
                </li>
              ))}
              {!overview.emailDeliveries.length && <li className="text-[#6B7280]">none</li>}
            </ul>
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-2 font-medium">Generations (metadata only, last 20)</h2>
            <ul className="space-y-1 text-sm">
              {overview.generations.map((g, i) => (
                <li key={i}>
                  {g.createdAt.slice(0, 16)} · {g.route} · {g.status ?? "reserved"}
                  {g.fallbackUsed && " · fallback"}
                </li>
              ))}
              {!overview.generations.length && <li className="text-[#6B7280]">none</li>}
            </ul>
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-2 font-medium">Audit history</h2>
            <ul className="space-y-1 text-sm">
              {overview.auditHistory.map((a, i) => (
                <li key={i}>
                  {a.createdAt.slice(0, 16)} · {a.action} — {a.reason}
                </li>
              ))}
              {!overview.auditHistory.length && <li className="text-[#6B7280]">none</li>}
            </ul>
          </section>

          <UserActions
            targetUserId={overview.account.id}
            verified={overview.account.emailVerified}
            flags={overview.flags}
            role={caller.role}
            stepUpActions={Object.entries(ADMIN_ACTION_POLICY)
              .filter(([, p]) => p.requiresStepUp)
              .map(([a]) => a)}
          />
        </div>
      )}
    </main>
  );
}
