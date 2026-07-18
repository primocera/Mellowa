import { describe, expect, it } from "vitest";
import { isValidIdempotencyKey } from "@/lib/ai/idempotency";

describe("idempotency key validation (v6 Prompt 7)", () => {
  it("accepts uuid-style keys", () => {
    expect(isValidIdempotencyKey("6f1c2a34-9b0d-4e5f-8a7b-1c2d3e4f5a6b")).toBe(true);
    expect(isValidIdempotencyKey("abc12345")).toBe(true);
  });

  it("rejects missing, short, long or unsafe values", () => {
    expect(isValidIdempotencyKey(null)).toBe(false);
    expect(isValidIdempotencyKey(undefined)).toBe(false);
    expect(isValidIdempotencyKey("short")).toBe(false);
    expect(isValidIdempotencyKey("a".repeat(65))).toBe(false);
    expect(isValidIdempotencyKey("bad key with spaces")).toBe(false);
    expect(isValidIdempotencyKey("key;drop table")).toBe(false);
    expect(isValidIdempotencyKey(42)).toBe(false);
  });
});
