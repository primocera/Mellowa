import { describe, it, expect } from "vitest";
import {
  validateLegalConfig,
  isPaidLaunch,
  readLegalConfig,
} from "@/lib/legal/config";

const complete = {
  LEGAL_ENTITY_NAME: "Mellowa d.o.o.",
  LEGAL_REGISTERED_ADDRESS: "Example ulica 1, 1000 Ljubljana, Slovenia",
  LEGAL_GOVERNING_LAW: "Slovenia",
  SUPPORT_EMAIL: "support@mellowa.app",
  EMAIL_FROM: "Mellowa <hello@mellowa.app>",
  NEXT_PUBLIC_APP_URL: "https://mellowa.app",
};

describe("legal/production config (Prompt 17)", () => {
  it("a complete production config has no problems", () => {
    expect(validateLegalConfig(complete)).toEqual([]);
  });

  it("flags placeholder domains, emails and missing identity", () => {
    const problems = validateLegalConfig({
      NEXT_PUBLIC_APP_URL: "https://mellowaa.vercel.app",
      EMAIL_FROM: "Mellowa <onboarding@resend.dev>",
    });
    expect(problems.join(" ")).toMatch(/vercel\.app/);
    expect(problems.join(" ")).toMatch(/resend\.dev/);
    expect(problems.join(" ")).toMatch(/LEGAL_ENTITY_NAME/);
    expect(problems.join(" ")).toMatch(/SUPPORT_EMAIL/);
  });

  it("paid launch mode is explicit and off by default", () => {
    expect(isPaidLaunch({})).toBe(false);
    expect(isPaidLaunch({ LAUNCH_MODE: "paid" })).toBe(true);
  });

  it("support email falls back safely and is always defined", () => {
    expect(readLegalConfig({}).supportEmail).toContain("@");
    expect(readLegalConfig(complete).privacyEmail).toBe("support@mellowa.app");
  });
});
