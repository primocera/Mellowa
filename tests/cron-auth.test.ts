import { describe, it, expect } from "vitest";
import {
  requireBearerSecret,
  missingOperationalSecrets,
} from "@/lib/cron-auth";

const req = (auth?: string) =>
  new Request("http://localhost/api/cron/test", {
    headers: auth ? { authorization: auth } : {},
  });

describe("requireBearerSecret (Prompt 1, fail-closed)", () => {
  it("returns 503 not_configured when the secret is missing", async () => {
    for (const missing of [null, undefined, ""]) {
      const res = requireBearerSecret(req("Bearer anything"), missing);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(503);
      expect((await res!.json()).error).toBe("not_configured");
    }
  });

  it("returns 401 for a missing Authorization header", () => {
    const res = requireBearerSecret(req(), "s3cret");
    expect(res!.status).toBe(401);
  });

  it("returns 401 for a wrong bearer token", () => {
    expect(requireBearerSecret(req("Bearer wrong"), "s3cret")!.status).toBe(401);
    expect(requireBearerSecret(req("Bearer s3cret2"), "s3cret")!.status).toBe(401);
    expect(requireBearerSecret(req("s3cret"), "s3cret")!.status).toBe(401);
  });

  it("returns null (authorized) for the correct bearer token", () => {
    expect(requireBearerSecret(req("Bearer s3cret"), "s3cret")).toBeNull();
  });
});

describe("missingOperationalSecrets (deploy validation)", () => {
  it("requires CRON_SECRET and ADMIN_STATS_SECRET in production", () => {
    expect(missingOperationalSecrets({ NODE_ENV: "production" })).toEqual([
      "CRON_SECRET",
      "ADMIN_STATS_SECRET",
    ]);
    expect(
      missingOperationalSecrets({
        NODE_ENV: "production",
        CRON_SECRET: "a",
      })
    ).toEqual(["ADMIN_STATS_SECRET"]);
    expect(
      missingOperationalSecrets({
        NODE_ENV: "production",
        CRON_SECRET: "a",
        ADMIN_STATS_SECRET: "b",
      })
    ).toEqual([]);
  });

  it("does not require secrets in development, test or preview", () => {
    expect(missingOperationalSecrets({ NODE_ENV: "development" })).toEqual([]);
    expect(missingOperationalSecrets({ NODE_ENV: "test" })).toEqual([]);
    expect(
      missingOperationalSecrets({ NODE_ENV: "production", VERCEL_ENV: "preview" })
    ).toEqual([]);
  });
});
