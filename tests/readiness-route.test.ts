import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * MW-05: the public readiness endpoint must fail closed. When EUR pricing is
 * ENABLED it can only report ready once the owner has verified the EUR
 * currency_options on live Stripe and set EUR_PRICING_VERIFIED=1 — because
 * checkout charges EUR with no USD fallback. It must never leak a price id.
 */

import { GET } from "@/app/api/admin/readiness/route";

afterEach(() => {
  vi.unstubAllEnvs();
});

async function call() {
  const res = await GET();
  const body = await res.json();
  return { status: res.status, body };
}

describe("readiness endpoint", () => {
  it("is READY (200) with prices configured and EUR pricing OFF", async () => {
    vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_m");
    vi.stubEnv("STRIPE_PRICE_PRO_YEARLY", "price_y");
    vi.stubEnv("EUR_PRICING_ENABLED", "");
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.pricing.eurPricingEnabled).toBe(false);
  });

  it("is NOT READY (503) when a price env var is missing", async () => {
    vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_m");
    vi.stubEnv("STRIPE_PRICE_PRO_YEARLY", "");
    const { status, body } = await call();
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
  });

  it("is NOT READY (503) when EUR pricing is ON but unverified", async () => {
    vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_m");
    vi.stubEnv("STRIPE_PRICE_PRO_YEARLY", "price_y");
    vi.stubEnv("EUR_PRICING_ENABLED", "1");
    vi.stubEnv("EUR_PRICING_VERIFIED", "");
    const { status, body } = await call();
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.pricing.eurPricingVerified).toBe(false);
    expect(body.pricing.note).toMatch(/NOT READY/);
  });

  it("is READY (200) when EUR pricing is ON and verified", async () => {
    vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_m");
    vi.stubEnv("STRIPE_PRICE_PRO_YEARLY", "price_y");
    vi.stubEnv("EUR_PRICING_ENABLED", "1");
    vi.stubEnv("EUR_PRICING_VERIFIED", "1");
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.pricing.eurPricingVerified).toBe(true);
  });

  it("never leaks a price id in the public JSON", async () => {
    vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_secret_monthly_id");
    vi.stubEnv("STRIPE_PRICE_PRO_YEARLY", "price_secret_yearly_id");
    const { body } = await call();
    const json = JSON.stringify(body);
    expect(json).not.toContain("price_secret_monthly_id");
    expect(json).not.toContain("price_secret_yearly_id");
    // Only booleans are exposed for configuration.
    expect(body.priceEnvVarsConfigured).toEqual({ monthly: true, yearly: true });
  });
});
