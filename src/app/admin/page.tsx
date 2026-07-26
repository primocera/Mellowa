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
  const eur = (v: number | null) => (v === null ? "—" : `€${v.toFixed(2)}`);
  const csvHref = `/admin/export?window=${windowDays}${release ? `&release=${encodeURIComponent(release)}` : ""}`;

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "24px 16px", color: "#1F2937" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600 }}>Metrics</h1>
        <a href="/admin/users" className="text-sm text-[#6D8C7D] underline">Support console →</a>
      <p style={{ color: "#6B7280", fontSize: 14 }}>
        Window: last {r.windowDays} days · Generated {new Date(r.generatedAt).toUTCString()}
        {r.release ? ` · Release ${r.release}` : ""} · Small cohorts (&lt;5) suppressed as “—”.
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

      <Section title="Unit economics (estimate — excludes Stripe fees & refunds)">
        <Row label="Active payers" value={String(r.economics.activePayers)} />
        <Row label="MRR" value={eur(r.economics.mrrEur)} />
        <Row label="AI cost" value={eur(r.economics.aiCostEur)} />
        <Row label="Contribution / payer / mo" value={eur(r.economics.contributionPerUserEur)} />
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

      <Section title="Beta value loop (signup → renewal)">
        {r.funnels.value_loop.map((step) => (
          <Row
            key={step.event}
            label={step.event}
            value={`${step.reached}${step.stepRate !== null ? ` · ${pct(step.stepRate)}` : ""}`}
          />
        ))}
        <p style={{ color: "#9CA3AF", fontSize: 12, marginTop: 6 }}>
          Each row: distinct people reached · step conversion from the prior step
          (— when the prior cohort is under 5). Decision mapping in
          docs/beta-research.md.
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
