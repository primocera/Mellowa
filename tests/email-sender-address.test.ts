import { readFileSync } from "node:fs";
import { describe, expect, it, afterEach } from "vitest";
import { serverEnv } from "@/lib/env";

/**
 * Mellowa had never successfully sent a single email.
 *
 * Production ran with `EMAIL_FROM=<hello@mellowa.app>` — angle brackets, no
 * display name. Providers accept `user@domain` or `Name <user@domain>`; a bare
 * `<user@domain>` is malformed. Resend answered 422 to every send, so fifteen
 * consecutive attempts across welcome, verification, trial-started,
 * trial-ending, cancellation and account-deleted all became `failed_permanent`.
 *
 * Nothing surfaced it. The provider's explanation was fetched and logged but
 * discarded before reaching `email_deliveries`, so the admin delivery-health
 * view showed a wall of identical "provider 422" with nothing actionable. It
 * was found only because the owner noticed he received mail from a *different*
 * product on the shared Stripe account, and none from this one.
 */

const original = process.env.EMAIL_FROM;
afterEach(() => {
  if (original === undefined) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = original;
});

describe("the sender address is always something a provider will accept", () => {
  it("repairs the bare-angle-bracket form that broke production", () => {
    process.env.EMAIL_FROM = "<hello@mellowa.app>";
    expect(serverEnv.emailFrom).toBe("hello@mellowa.app");
  });

  it("leaves a correctly formatted display-name address alone", () => {
    process.env.EMAIL_FROM = "Mellowa <hello@mellowa.app>";
    expect(serverEnv.emailFrom).toBe("Mellowa <hello@mellowa.app>");
  });

  it("leaves a plain address alone", () => {
    process.env.EMAIL_FROM = "hello@mellowa.app";
    expect(serverEnv.emailFrom).toBe("hello@mellowa.app");
  });

  it("trims stray whitespace rather than sending it", () => {
    process.env.EMAIL_FROM = "  < hello@mellowa.app >  ";
    expect(serverEnv.emailFrom).toBe("hello@mellowa.app");
  });

  it("falls back to a valid address when unset or empty", () => {
    delete process.env.EMAIL_FROM;
    expect(serverEnv.emailFrom).toMatch(/^[^<>]+<[^<>@\s]+@[^<>\s]+>$/);
    process.env.EMAIL_FROM = "   ";
    expect(serverEnv.emailFrom).toMatch(/@/);
  });

  it("never yields a value wrapped in angle brackets with no display name", () => {
    for (const value of ["<a@b.co>", " <a@b.co> ", "a@b.co", "N <a@b.co>"]) {
      process.env.EMAIL_FROM = value;
      expect(serverEnv.emailFrom, `from "${value}"`).not.toMatch(/^<[^<>]+>$/);
    }
  });
});

describe("a failed send records why, not just that it failed", () => {
  const send = readFileSync("src/lib/email/send.ts", "utf8");

  it("keeps the provider's message in the stored error", () => {
    expect(send).toMatch(/provider \$\{res\.status\}: \$\{reason\}/);
  });

  it("redacts addresses before storing, because an admin view reads this", () => {
    expect(send).toMatch(/\[address\]/);
  });

  it("bounds the stored reason so one provider can't flood the table", () => {
    expect(send).toMatch(/\.slice\(0, 200\)/);
  });
});
