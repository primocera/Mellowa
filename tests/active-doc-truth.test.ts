import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ReleaseManifest } from "@/lib/release/manifest";
import {
  SUPPORT_SLA_GUARANTEED,
  SUPPORT_REPLY_COPY,
  SUPPORT_NOT_MONITORED_COPY,
} from "@/lib/support/policy";

/**
 * MW-V17-09: the active docs cannot contradict the machine truth.
 *
 * README/status/audit claims are machine-derived, and customer-facing support
 * timing matches an operationally owned commitment (or is best-effort). A stale
 * "release loop closed", a hard-coded verdict, a "0 vulnerabilities" claim that
 * could drift, or a guaranteed SLA with no operation behind it fails here.
 */

const read = (p: string) => readFileSync(p, "utf8");
const v16 = (): ReleaseManifest =>
  JSON.parse(read("docs/release/manifest.v16.json")) as ReleaseManifest;

describe("README defers to machine-generated release truth", () => {
  const readme = read("README.md");

  it("does not claim the release loop is closed while the v16 candidate is a draft", () => {
    const m = v16();
    const draft = m.candidateLifecycle === "draft" || m.rcSha === null;
    expect(draft, "test premise: v16 candidate is draft").toBe(true);
    expect(readme).not.toMatch(/release loop is closed/i);
    expect(readme).not.toMatch(/the path to launch is clean and the release loop/i);
  });

  it("does not hard-code an active GO/CONDITIONAL GO verdict in the release section", () => {
    const section = readme.slice(
      readme.indexOf("## Release status"),
      readme.indexOf("## Project state"),
    );
    expect(section).not.toMatch(/\|\s*(CONDITIONAL )?GO\s*\|/);
    // It must instead say the honest current state.
    expect(section).toMatch(/UNASSESSED/);
    expect(section).toMatch(/draft/i);
  });

  it("links to the generated status, manifest and dependency-audit evidence rather than restating them", () => {
    expect(readme).toContain("docs/release/v16/STATUS.md");
    expect(readme).toContain("docs/release/manifest.v16.json");
    expect(readme).toContain("docs/release/evidence/v17/dependency-audit.md");
  });

  it("makes no standalone current 'zero vulnerabilities' claim that could drift", () => {
    // The dependency posture points at the audit evidence; it must not assert a
    // bare "0 vulnerabilities" as prose in the current section.
    const section = readme.slice(
      readme.indexOf("## Release status"),
      readme.indexOf("## Project state"),
    );
    expect(section).not.toMatch(/0 vulnerabilities/i);
    expect(section).not.toMatch(/zero vulnerabilities/i);
  });

  it("marks earlier release snapshots as archived/not current", () => {
    expect(readme).toMatch(/archived — not current/i);
  });
});

describe("support timing is consistent and not a hollow guarantee", () => {
  const help = read("src/app/(app)/help/page.tsx");
  const settings = read("src/app/(app)/settings/page.tsx");

  it("Help and Settings both render the one shared support-reply copy and the emergency boundary", () => {
    for (const src of [help, settings]) {
      expect(src).toContain("SUPPORT_REPLY_COPY");
      expect(src).toContain("SUPPORT_NOT_MONITORED_COPY");
      // No hard-coded guaranteed-SLA sentence.
      expect(src).not.toMatch(/replies within 2 business days/i);
    }
  });

  it("uses best-effort wording unless a real support operation is declared", () => {
    if (SUPPORT_SLA_GUARANTEED) {
      expect(SUPPORT_REPLY_COPY).toMatch(/within two business days/i);
    } else {
      // Best-effort: 'aim to', never a guarantee.
      expect(SUPPORT_REPLY_COPY).toMatch(/aim to reply/i);
      expect(SUPPORT_REPLY_COPY).not.toMatch(/guarantee/i);
    }
    expect(SUPPORT_NOT_MONITORED_COPY).toMatch(/not monitor/i);
  });
});
