import { readFileSync, readdirSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CRON_REGISTRY, jobForRoute } from "@/lib/ops/cron-registry";

/**
 * MW-05: the cron registry is the source of truth for every scheduled/operational
 * job. This enforces that no cron route can exist without a documented schedule,
 * lease, alert and runbook, and that no registry entry names a route that does
 * not exist or a cadence that disagrees with vercel.json.
 */

const CRON_DIR = "src/app/api/cron";

function cronRouteDirs(): string[] {
  return readdirSync(CRON_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(`${CRON_DIR}/${name}/route.ts`));
}

describe("cron registry ↔ filesystem", () => {
  it("every cron route directory has exactly one registry entry", () => {
    for (const dir of cronRouteDirs()) {
      const route = `/api/cron/${dir}`;
      const matches = CRON_REGISTRY.filter((j) => j.route === route);
      expect(matches, `no registry entry for ${route}`).toHaveLength(1);
    }
  });

  it("every registry entry points at a route file that exists", () => {
    for (const job of CRON_REGISTRY) {
      const dir = job.route.replace("/api/cron/", "");
      expect(existsSync(`${CRON_DIR}/${dir}/route.ts`), `${job.route} route missing`).toBe(true);
    }
  });
});

describe("cron registry ↔ vercel.json", () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    crons?: { path: string; schedule: string }[];
  };
  const vercelCrons = vercel.crons ?? [];

  it("every Vercel-scheduled registry entry matches a vercel.json cron", () => {
    for (const job of CRON_REGISTRY.filter((j) => j.schedule.source === "vercel")) {
      const cron = vercelCrons.find((c) => c.path === job.route);
      expect(cron, `${job.route} not in vercel.json`).toBeTruthy();
      expect(cron!.schedule).toBe(job.schedule.cron);
    }
  });

  it("every vercel.json cron is a Vercel-source registry entry", () => {
    for (const c of vercelCrons) {
      const job = jobForRoute(c.path);
      expect(job, `${c.path} missing from registry`).toBeTruthy();
      expect(job!.schedule.source).toBe("vercel");
    }
  });
});

describe("cron registry completeness + safety", () => {
  it("every entry has a secret name, cadence, lease, alert threshold and runbook", () => {
    for (const job of CRON_REGISTRY) {
      expect(job.authSecretEnv, `${job.id} authSecretEnv`).toBeTruthy();
      expect(job.schedule.cadence, `${job.id} cadence`).toBeTruthy();
      expect(job.lease.mechanism, `${job.id} lease`).toBeTruthy();
      expect(job.alertThresholdMinutes, `${job.id} alert`).toBeGreaterThan(0);
      expect(job.runbook, `${job.id} runbook`).toContain("docs/ops-cron.md");
      expect(job.owner).toBeTruthy();
    }
  });

  it("stores only env-var NAMES, never a secret value", () => {
    const raw = readFileSync("src/lib/ops/cron-registry.ts", "utf8");
    // A bearer secret would be a long hex/base64 blob; the registry has none.
    expect(raw).not.toMatch(/[A-Fa-f0-9]{32,}/);
    for (const job of CRON_REGISTRY) {
      expect(job.authSecretEnv).toMatch(/^[A-Z0-9_]+$/);
    }
  });

  it("docs/ops-cron.md documents every registered route", () => {
    const doc = readFileSync("docs/ops-cron.md", "utf8");
    for (const job of CRON_REGISTRY) {
      expect(doc, `${job.route} undocumented`).toContain(job.route);
    }
  });

  // MW-05: a registry-declared cron_leases lease must be ACQUIRED at runtime —
  // metadata claiming a lease the route never takes is exactly the retention /
  // billing-reconcile gap this pack closed.
  it("every cron_leases-declared job actually acquires a lease at runtime", () => {
    for (const job of CRON_REGISTRY.filter((j) => /cron_leases/i.test(j.lease.mechanism))) {
      const dir = job.route.replace("/api/cron/", "");
      const src = readFileSync(`${CRON_DIR}/${dir}/route.ts`, "utf8");
      const acquires = /acquireCronLease|runCronJob/.test(src);
      expect(acquires, `${job.route} declares a cron_leases lease but never acquires one`).toBe(
        true
      );
    }
  });
});
