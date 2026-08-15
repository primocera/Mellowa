import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin/auth";
import { buildMetricsReport } from "@/lib/analytics/report";

export const metadata: Metadata = { title: "Admin metrics — Mellowa", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Read-only metrics dashboard (Launch v6, Prompt 10). Admin-authorized users
 *  only; unauthorized callers get a 404 (the route's existence isn't revealed). */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; release?: string }>;
}) {
  const adminId = await requireAdmin();
  if (!adminId) notFound();

  const params = await searchParams;
  const windowDays = Math.min(Math.max(Number(params.window ?? 30), 1), 365);
  const release = params.release ?? null;
  const r = await buildMetricsReport(windowDays, release);

  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
  // Currency-aware money: a EUR figure renders with € and a USD one with $, so
  // the dashboard never labels a euro amount with a dollar sign or vice versa.
  const money = (currency: string, v: number | null) =>
    v === null ? "—" : `${currency === "eur" ? "€" : "$"}${v.toFixed(2)}`;
  // MW-V10-06: "unknown" is rendered as "unknown", never as $0.00 — a zero
  // reads as "this costs us nothing", which is the opposite of no data.
  const usd = (v: number | null) => (v === null ? "unknown" : `$${v.toFixed(2)}`);
  const csvHref = `/admin/export?window=${windowDays}${release ? `&release=${encodeURIComponent(release)}` : ""}`;

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "24px 16px", color: "#1F2937" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600 }}>Metrics</h1>
        <a href="/admin/users" className="text-sm text-[#6D8C7D] underline">Support console →</a>
      <p style={{ color: "#6B7280", fontSize: 14 }}>
        Window: last {r.windowDays} days · Generated {new Date(r.generatedAt).toUTCString()}
        {r.release ? ` · Release ${r.release}` : ""} · Small cohorts (&lt;5) suppressed as “—”.
      </p>
      {/* MW-V12-08: data freshness — "Generated" is always now, so it cannot
          reveal a pipeline that has gone quiet. This can. */}
      <p
        style={{
          fontSize: 14,
          fontWeight: r.dataFreshness.stale ? 600 : 400,
          color: r.dataFreshness.stale ? "#B45309" : "#6B7280",
          background: r.dataFreshness.stale ? "#FEF3C7" : "transparent",
          padding: r.dataFreshness.stale ? "6px 10px" : 0,
          borderRadius: 8,
          display: "inline-block",
        }}
      >
        {r.dataFreshness.lastEventAt === null
          ? "⚠ Data freshness: no events in this window — every rate below is over an empty set. Do not read this as a result."
          : `Data freshness: last event ${r.dataFreshness.ageHours}h ago${
              r.dataFreshness.stale
                ? " — STALE (>48h). The pipeline may be broken; treat the numbers below with suspicion."
                : "."
            }`}
      </p>

      <form style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        {[7, 30, 90].map((d) => (
          <a key={d} href={`?window=${d}`} style={chip(d === windowDays)}>
            {d}d
          </a>
        ))}
        <a href={csvHref} style={{ ...chip(false), marginLeft: "auto" }}>
          Download CSV
        </a>
      </form>

      {r.anomalies.length > 0 && (
        <div style={{ background: "#FEE2E2", borderRadius: 12, padding: 12, marginBottom: 16 }}>
          <strong>Funnel drop alert</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {r.anomalies.map((a) => (
              <li key={a.metric}>
                {a.metric}: {a.current} vs {a.baseline} baseline ({Math.round(a.dropPct * 100)}% down)
              </li>
            ))}
          </ul>
        </div>
      )}

      <Section title="Conversion">
        <Row label="Sample → trial" value={pct(r.sampleToTrial.rate)} />
        <Row label="Trial → paid" value={pct(r.trialToPaid.rate)} />
        <Row label="Retention D1 / D7 / D30" value={`${pct(r.retention.d1)} / ${pct(r.retention.d7)} / ${pct(r.retention.d30)}`} />
      </Section>

      <Section title="Scale readiness (SLOs & budgets)">
        <Row
          label="Scale ready?"
          value={r.observability.scaleReady ? "YES" : "NO — not yet (see reasons)"}
        />
        <Row
          label="Capacity"
          value={r.observability.capacity.available ? (r.observability.capacity.fits ? "fits at 10x" : "over at 10x") : "unavailable (load-test needed)"}
        />
        {r.observability.blockingReasons.length > 0 && (
          <Row label="Blocking" value={r.observability.blockingReasons.join(" · ")} />
        )}
      </Section>

      <Section title="Pricing discovery (read-only — no price change here)">
        <Row
          label="Can recommend a price change?"
          value={r.pricingDiscovery.canRecommendPriceChange ? "YES — evaluate on evidence" : "NO — blocked on evidence"}
        />
        {r.pricingDiscovery.requiredButMissing.length > 0 && (
          <Row label="Awaiting maturity" value={r.pricingDiscovery.requiredButMissing.join(", ")} />
        )}
        {r.pricingDiscovery.risksPresent.length > 0 && (
          <Row label="Risk signals" value={r.pricingDiscovery.risksPresent.join(", ")} />
        )}
      </Section>

      <Section title={`First session (value within ${r.firstSession.windowMin} min)`}>
        {r.firstSession.suppressed ? (
          <Row label="Cohort" value={`— (under 5; ${r.firstSession.cohortSize} entered)`} />
        ) : (
          <>
            <Row label="Entered funnel" value={String(r.firstSession.cohortSize)} />
            {r.firstSession.milestones.map((m) => (
              <Row key={m.milestone} label={MILESTONE_LABELS[m.milestone]} value={String(m.reached)} />
            ))}
            <Row
              label="First value: reached / pending / missed"
              value={`${r.firstSession.firstValue.reached} / ${r.firstSession.firstValue.pending} / ${r.firstSession.firstValue.missed}`}
            />
          </>
        )}
      </Section>

      <Section title="Unit economics (gross — excludes Stripe fees & refunds)">
        <Row label="Active payers" value={String(r.economics.activePayers)} />
        {r.economics.mrrByCurrency.length === 0 ? (
          <Row label="MRR" value="—" />
        ) : (
          r.economics.mrrByCurrency.map((c) => (
            <Row
              key={c.currency}
              label={`MRR (${c.currency.toUpperCase()})`}
              value={money(c.currency, c.mrr)}
            />
          ))
        )}
        {r.economics.unknownCurrencyPayers > 0 && (
          <Row
            label="Payers w/ unknown currency"
            value={`${r.economics.unknownCurrencyPayers} (revenue unknown)`}
          />
        )}
        <Row label="AI cost (USD)" value={usd(r.economics.aiCostUsd)} />
        <Row
          label="Contribution / payer / mo"
          value={
            r.economics.normalizedUsd
              ? `${usd(r.economics.normalizedUsd.contributionPerPayerUsd)} (USD est., ${r.economics.normalizedUsd.fx.source})`
              : "unknown (no FX rate)"
          }
        />
      </Section>

      <Section title="Usage & cost distribution (fair-use)">
        <Row label="Active AI users" value={String(r.usage.activeUsers)} />
        <Row label="Generations p50 / user" value={String(r.usage.generationsP50 ?? "—")} />
        <Row label="Generations p90 / user" value={String(r.usage.generationsP90 ?? "—")} />
        <Row
          label={`High-use users (≥${r.usage.highUseThreshold}/mo)`}
          value={String(r.usage.highUseUsers)}
        />
        <Row label="Global ceiling denials" value={String(r.usage.ceilingDenials)} />
        <Row label="AI cost (window)" value={`$${r.usage.totalCostUsd.toFixed(2)}`} />
      </Section>

      <Section title="Generation health">
        <Row label="Generated" value={String(r.generation.generated)} />
        <Row label="Fallback served" value={String(r.generation.fallbackServed)} />
        <Row label="Safety blocked" value={String(r.generation.safetyBlocked)} />
        <Row label="Fallback rate" value={pct(r.generation.fallbackRate)} />
      </Section>

      <Section title="Churn">
        <Row label="Voluntary (cancels)" value={String(r.churn.voluntary)} />
        <Row label="Involuntary (payment fails)" value={String(r.churn.involuntary)} />
      </Section>

      {/* MW-V10-06: intake control. Closing it blocks NEW accounts only —
          nothing is deleted, so a stop is instantly reversible. */}
      <Section title="Beta intake (MW-V10-06)">
        {r.beta === null ? (
          <p style={{ color: "#991B1B", fontSize: 14 }}>
            Capacity could not be read — the cap may not be enforced. Check that
            migration 039 is applied.
          </p>
        ) : (
          <>
            <Row
              label="Signups"
              value={r.beta.signupsOpen ? "OPEN" : "CLOSED (stop switch on)"}
            />
            <Row
              label="Accounts / cap"
              value={`${r.beta.used} / ${r.beta.inviteCap ?? "uncapped"}`}
            />
            <Row
              label="Remaining invites"
              value={r.beta.remaining === null ? "—" : String(r.beta.remaining)}
            />
            {r.beta.full && (
              <p style={{ color: "#991B1B", fontSize: 13, marginTop: 6 }}>
                New signups are being rejected right now.
              </p>
            )}
          </>
        )}
        <p style={{ color: "#9CA3AF", fontSize: 12, marginTop: 6 }}>
          Enforced by a database trigger, not the signup form — the form calls
          Supabase directly, so a UI check would not be a cap. To stop intake:
          <code> update beta_settings set signups_open = false; </code>
          No data is deleted and existing users are unaffected.
        </p>
      </Section>

      {r.experimentConflicts.length > 0 && (
        <div style={{ background: "#FEE2E2", borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <strong>Overlapping experiments</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {r.experimentConflicts.map((c) => (
              <li key={c.area}>{c.message}</li>
            ))}
          </ul>
        </div>
      )}

      <Section title="Beta value loop (signup → renewal) — with the decision">
        <div
          style={{
            background: r.expansion.canExpand ? "#DCFCE7" : "#FEF3C7",
            borderRadius: 8,
            padding: 10,
            marginBottom: 10,
            fontSize: 13,
          }}
        >
          <strong>
            {r.expansion.canExpand ? "Expansion: OK" : "Expansion: BLOCKED"}
          </strong>
          <div style={{ marginTop: 4 }}>{r.expansion.reason}</div>
        </div>
        {r.loop.map((d) => (
          <div key={d.event} style={{ marginBottom: 8 }}>
            <Row
              label={`${d.event} — ${d.readsAs}`}
              value={
                `${d.numerator}` +
                (d.denominator === null ? "" : ` / ${d.denominator}`) +
                (d.rate === null ? "  ·  no data" : `  ·  ${pct(d.rate)}`) +
                (d.hypothesis === null ? "" : ` (need ${pct(d.hypothesis)})`)
              }
            />
            <div
              style={{
                paddingLeft: 12,
                fontSize: 12,
                color: d.state === "below_hypothesis" ? "#991B1B" : "#9CA3AF",
              }}
            >
              {d.decision}
            </div>
          </div>
        ))}
        <p style={{ color: "#9CA3AF", fontSize: 12, marginTop: 6 }}>
          numerator / denominator · step conversion · hypothesis. &ldquo;No
          data&rdquo; (cohort under 5) and &ldquo;below hypothesis&rdquo; are
          different states and must not be reported as the same thing. Window:
          last {r.windowDays} days. Full mapping in docs/beta-research.md.
        </p>
      </Section>

      <Section title="Cost per outcome (MW-V10-06) — null means unknown, not zero">
        <Row label="Total AI cost (window)" value={`$${r.costPerOutcome.totalCostUsd.toFixed(2)}`} />
        <Row label="Per sample generated" value={usd(r.costPerOutcome.perSampleUsd)} />
        <Row label="Per activated trial" value={usd(r.costPerOutcome.perActivatedTrialUsd)} />
        <Row label="Per retained payer" value={usd(r.costPerOutcome.perRetainedPayerUsd)} />
        <Row label="Per high-use user (mean)" value={usd(r.costPerOutcome.perHighUseUserUsd)} />
        <p style={{ color: "#9CA3AF", fontSize: 12, marginTop: 6 }}>
          Not included: {r.costPerOutcome.unknowns.join("; ")}.
        </p>
      </Section>

      <Section title="Email delivery (MW-V10-05) — categories only, no content">
        <Row label="Backlog (retryable, waiting)" value={String(r.email.backlog)} />
        <Row
          label="Oldest backlog item"
          value={
            r.email.oldestBacklogHours === null
              ? "—"
              : `${r.email.oldestBacklogHours}h`
          }
        />
        <Row label="Dead letters (given up)" value={String(r.email.deadLetter)} />
        <Row label="Delivery rate" value={pct(r.email.deliveryRate)} />
        {Object.entries(r.email.byStatus).map(([status, n]) => (
          <Row key={status} label={`  status: ${status}`} value={String(n)} />
        ))}
        {Object.entries(r.email.deadLetterByTemplate).map(([template, n]) => (
          <Row key={template} label={`  dead letter: ${template}`} value={String(n)} />
        ))}
        <p style={{ color: "#9CA3AF", fontSize: 12, marginTop: 6 }}>
          Recipients, subjects and message bodies are deliberately not queried —
          delivery health is observable without reading anyone&rsquo;s mail. A
          growing backlog with a healthy delivery rate means the outbox worker
          is not running; see docs/ops-cron.md.
        </p>
      </Section>

      <Section title="Trial-length experiment (MW-V10-02)">
        {r.trialExperiment.length === 0 ? (
          <p style={{ color: "#6B7280", fontSize: 14 }}>
            No cohort assigned yet — every trial is the 3-day control. Enable
            with FLAG_TRIAL_LENGTH_EXPERIMENT; stop rules in
            docs/experiments/trial-length.md.
          </p>
        ) : (
          <>
            {r.trialExperiment.map((v) => (
              <div key={v.variant} style={{ marginBottom: 10 }}>
                <Row
                  label={`${v.variant} · ${v.trialDays ?? "—"}-day · n=${v.cohortSize}`}
                  value={v.suppressed ? "not enough data" : pct(v.conversionRate)}
                />
                <div style={{ paddingLeft: 12 }}>
                  <Row
                    label="Returned after day 1"
                    value={String(v.returnedAfterDay1 ?? "—")}
                  />
                  <Row label="Adjusted a day" value={String(v.repaired ?? "—")} />
                  <Row
                    label="Reached a real week closeout"
                    value={String(v.weeklyReflection ?? "—")}
                  />
                  <Row label="Charged" value={String(v.converted ?? "—")} />
                  <Row label="Canceled" value={String(v.canceled ?? "—")} />
                  <Row
                    label="AI cost (window)"
                    value={v.costUsd === null ? "—" : `$${v.costUsd.toFixed(2)}`}
                  />
                </div>
              </div>
            ))}
            <p style={{ color: "#9CA3AF", fontSize: 12, marginTop: 6 }}>
              Cohorts come from the trial length pinned at checkout, so turning
              the flag off does not move anyone between arms. “not enough data”
              means the arm is under 5 people — not a zero result. Stop rules:
              docs/experiments/trial-length.md.
            </p>
          </>
        )}
      </Section>

      <Section title="Reconciliation (events vs system-of-record)">
        {r.reconciliation.map((rec) => (
          <Row
            key={rec.metric}
            label={rec.metric}
            value={`${rec.fromEvents} / ${rec.fromSystem} · ${rec.reconciled ? "ok" : "MISMATCH"}`}
          />
        ))}
      </Section>
    </main>
  );
}

function chip(active: boolean) {
  return {
    padding: "6px 12px",
    borderRadius: 999,
    fontSize: 13,
    textDecoration: "none",
    color: active ? "#fff" : "#1F2937",
    background: active ? "#6D8C7D" : "#fff",
    border: "1px solid #E5E7EB",
  } as const;
}

const MILESTONE_LABELS: Record<string, string> = {
  onboardingCompletedAt: "Onboarding completed",
  firstCheckinAt: "First check-in",
  planCreatedAt: "Plan created",
  firstMeaningfulActionAt: "First meaningful action",
  firstValueAt: "First value",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: "#fff", borderRadius: 12, padding: 16, marginBottom: 12, border: "1px solid #EFEAE3" }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 14 }}>
      <span style={{ color: "#6B7280" }}>{label}</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}
