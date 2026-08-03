import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MW-P0-03: server-side protected-route auth, independent of the proxy.
 *
 * The framework patch (Next 16.2.12) closes the audited proxy-bypass/SSRF/DoS
 * advisories, but the security model must not depend on proxy middleware alone.
 * `requireUser` is the defense-in-depth gate the (app) layout calls on every
 * render. These tests prove it redirects an unauthenticated caller and lets an
 * authenticated one through even if the proxy never ran — a direct request to a
 * protected surface still enforces auth server-side.
 */

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  bypass: null as { id: string } | null,
  redirected: [] as string[],
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    h.redirected.push(url);
    // Match Next's contract: redirect() throws to halt rendering.
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
  }),
}));

vi.mock("@/lib/auth/dev-bypass", () => ({
  devBypassUser: () => h.bypass,
}));

beforeEach(() => {
  vi.clearAllMocks();
  h.user = null;
  h.bypass = null;
  h.redirected = [];
});

afterEach(() => {
  vi.resetModules();
});

describe("requireUser — server-side gate (no proxy)", () => {
  it("redirects an unauthenticated direct request to /login", async () => {
    h.user = null;
    const { requireUser } = await import("@/lib/auth/get-current-user");
    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(h.redirected).toEqual(["/login"]);
  });

  it("returns the user when authenticated (no redirect)", async () => {
    h.user = { id: "user-1" };
    const { requireUser } = await import("@/lib/auth/get-current-user");
    const user = await requireUser();
    expect(user).toMatchObject({ id: "user-1" });
    expect(h.redirected).toEqual([]);
  });

  it("getCurrentUser returns null (not a throw) for anonymous callers", async () => {
    h.user = null;
    const { getCurrentUser } = await import("@/lib/auth/get-current-user");
    expect(await getCurrentUser()).toBeNull();
  });
});
