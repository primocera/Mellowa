/**
 * MW-05: the single machine-readable registry of every scheduled/operational
 * job. It is the source of truth that pairs each background route with its
 * schedule, auth secret, lease, freshness expectation, alert threshold, owner
 * and runbook — so a job route cannot exist without documented operational
 * intent (enforced by tests/cron-registry-contract.test.ts).
 *
 * Contains ONLY env-var NAMES, never secret values. Cadence for Vercel-native
 * jobs is mirrored from vercel.json and verified against it in the contract test.
 */

export type ScheduleSource = "vercel" | "external";

export interface CronJob {
  /** Stable id. */
  id: string;
  /** Route path invoked by the scheduler. */
  route: string;
  /** HTTP method the scheduler must use. */
  method: "GET" | "POST";
  /** Bearer-secret ENV VAR NAME (never the value). */
  authSecretEnv: string;
  schedule: {
    source: ScheduleSource;
    /** Human cadence. */
    cadence: string;
    /** Cron expression for Vercel-native jobs (matched against vercel.json). */
    cron?: string;
  };
  owner: string;
  /** Function timeout budget (s). */
  timeoutSeconds: number;
  /** Rows processed per invocation, or null when the job is not batched. */
  batchSize: number | null;
  /** Overlap protection so two runs never process one item. */
  lease: {
    mechanism: string;
    minutes: number | null;
  };
  /** How recently a success is expected — drives the freshness alert. */
  lastSuccessExpectation: string;
  /** Alert if no success within this many minutes. */
  alertThresholdMinutes: number;
  /** Runbook anchor (section of docs/ops-cron.md). */
  runbook: string;
}

export const CRON_REGISTRY: readonly CronJob[] = [
  {
    id: "trial-reminders",
    route: "/api/cron/trial-reminders",
    method: "GET",
    authSecretEnv: "CRON_SECRET",
    schedule: { source: "vercel", cadence: "daily 09:00 UTC", cron: "0 9 * * *" },
    owner: "Owner",
    timeoutSeconds: 60,
    batchSize: 200,
    lease: { mechanism: "cron_leases (acquireCronLease)", minutes: 10 },
    lastSuccessExpectation: "within the last 24h",
    alertThresholdMinutes: 26 * 60,
    runbook: "docs/ops-cron.md#trial-and-daily-reminders",
  },
  {
    id: "daily-reminders",
    route: "/api/cron/daily-reminders",
    method: "GET",
    authSecretEnv: "CRON_SECRET",
    schedule: { source: "vercel", cadence: "daily 08:00 UTC", cron: "0 8 * * *" },
    owner: "Owner",
    timeoutSeconds: 60,
    batchSize: 200,
    lease: { mechanism: "cron_leases (acquireCronLease)", minutes: 10 },
    lastSuccessExpectation: "within the last 24h",
    alertThresholdMinutes: 26 * 60,
    runbook: "docs/ops-cron.md#trial-and-daily-reminders",
  },
  {
    id: "email-outbox",
    route: "/api/cron/email-outbox",
    method: "POST",
    authSecretEnv: "CRON_SECRET",
    schedule: { source: "external", cadence: "every 10–15 min (external pinger)" },
    owner: "Owner",
    timeoutSeconds: 60,
    batchSize: 50,
    lease: { mechanism: "claim_due_emails (SKIP LOCKED)", minutes: 10 },
    lastSuccessExpectation: "within the last 30 min when deliveries are due",
    alertThresholdMinutes: 60,
    runbook: "docs/ops-cron.md#email-outbox-worker-v6-prompt-4",
  },
  {
    id: "account-deletion",
    route: "/api/cron/account-deletion",
    method: "POST",
    authSecretEnv: "CRON_SECRET",
    schedule: { source: "external", cadence: "every 10–15 min (external pinger)" },
    owner: "Owner",
    timeoutSeconds: 60,
    batchSize: 10,
    lease: { mechanism: "account_deletion_requests.worker_leased_until", minutes: 5 },
    lastSuccessExpectation: "within the last 30 min when jobs are due",
    alertThresholdMinutes: 60,
    runbook: "docs/ops-cron.md#account-deletion-worker",
  },
  {
    id: "retention",
    route: "/api/cron/retention",
    method: "POST",
    authSecretEnv: "CRON_SECRET",
    schedule: { source: "external", cadence: "daily (external pinger)" },
    owner: "Owner",
    timeoutSeconds: 60,
    batchSize: null,
    lease: { mechanism: "cron_leases (acquireCronLease)", minutes: 10 },
    lastSuccessExpectation: "within the last 48h",
    alertThresholdMinutes: 50 * 60,
    runbook: "docs/ops-cron.md#retention-worker",
  },
  {
    id: "billing-reconcile",
    route: "/api/cron/billing-reconcile",
    method: "POST",
    authSecretEnv: "CRON_SECRET",
    schedule: { source: "external", cadence: "daily (external pinger)" },
    owner: "Owner",
    timeoutSeconds: 60,
    batchSize: null,
    lease: { mechanism: "cron_leases (acquireCronLease)", minutes: 10 },
    lastSuccessExpectation: "within the last 48h",
    alertThresholdMinutes: 50 * 60,
    runbook: "docs/ops-cron.md#billing-reconciliation-worker",
  },
] as const;

/** Lookup by route path. */
export function jobForRoute(route: string): CronJob | undefined {
  return CRON_REGISTRY.find((j) => j.route === route);
}
