import { describe, expect, it } from "vitest";
import { releaseVersion, summarizeReadiness } from "@/lib/health";

describe("readiness summary (v6 Prompt 5)", () => {
  it("is ok when everything is ok or merely unconfigured", () => {
    expect(
      summarizeReadiness({ database: "ok", stripe_config: "not_configured" }).ok
    ).toBe(true);
  });

  it("fails when any component fails", () => {
    expect(
      summarizeReadiness({ database: "fail", email_config: "ok" }).ok
    ).toBe(false);
  });

  it("reports a short release version and never a secret", () => {
    expect(
      releaseVersion({ VERCEL_GIT_COMMIT_SHA: "abcdef1234567890" })
    ).toBe("abcdef1");
    expect(releaseVersion({})).toBe("dev");
  });
});
