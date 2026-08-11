import { afterEach, describe, expect, it } from "vitest";
import {
  purgeCheckinDraft,
  purgeSensitiveBrowserStorage,
} from "@/lib/privacy/browser-storage";

/**
 * MW-V17-03: the purge helpers must remove sensitive/legacy browser storage on
 * check-in mount, sign-out and account deletion — without reading a value — and
 * must be safe when storage is unavailable (private mode).
 */

class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
  has(k: string) {
    return this.map.has(k);
  }
}

function withStorage(storage: unknown) {
  (globalThis as Record<string, unknown>).window = { localStorage: storage };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

describe("purgeCheckinDraft", () => {
  it("removes the legacy check-in draft key and leaves others", () => {
    const ls = new MemoryStorage();
    ls.setItem("mellowa_checkin_draft", JSON.stringify({ draft: { notes: "secret" } }));
    ls.setItem("mellowa_anon_id", "abc");
    withStorage(ls);
    purgeCheckinDraft();
    expect(ls.has("mellowa_checkin_draft")).toBe(false);
    expect(ls.has("mellowa_anon_id")).toBe(true);
  });

  it("is safe when window/localStorage is unavailable", () => {
    expect(() => purgeCheckinDraft()).not.toThrow();
  });
});

describe("purgeSensitiveBrowserStorage", () => {
  it("purges legacy sensitive keys, onboarding progress and deferral patterns; keeps the opaque anon id", () => {
    const ls = new MemoryStorage();
    ls.setItem("mellowa_checkin_draft", "x");
    ls.setItem("mellowa.onboarding.draft.v1", "x");
    ls.setItem("mellowa.onboarding.progress.v2", JSON.stringify({ step: 3 }));
    ls.setItem("mellowa_now_deferred:plan-1", "[]");
    ls.setItem("mellowa_now_deferred:plan-2", "[]");
    ls.setItem("mellowa_anon_id", "keep-me");
    withStorage(ls);

    purgeSensitiveBrowserStorage();

    expect(ls.has("mellowa_checkin_draft")).toBe(false);
    expect(ls.has("mellowa.onboarding.draft.v1")).toBe(false);
    expect(ls.has("mellowa.onboarding.progress.v2")).toBe(false);
    expect(ls.has("mellowa_now_deferred:plan-1")).toBe(false);
    expect(ls.has("mellowa_now_deferred:plan-2")).toBe(false);
    expect(ls.has("mellowa_anon_id")).toBe(true);
  });

  it("is idempotent", () => {
    const ls = new MemoryStorage();
    ls.setItem("mellowa.onboarding.progress.v2", "{}");
    withStorage(ls);
    purgeSensitiveBrowserStorage();
    expect(() => purgeSensitiveBrowserStorage()).not.toThrow();
    expect(ls.has("mellowa.onboarding.progress.v2")).toBe(false);
  });

  it("is safe when storage access throws (private mode)", () => {
    withStorage({
      get length(): number {
        throw new Error("SecurityError");
      },
      key() {
        throw new Error("SecurityError");
      },
      removeItem() {
        throw new Error("SecurityError");
      },
    });
    expect(() => purgeSensitiveBrowserStorage()).not.toThrow();
  });
});
