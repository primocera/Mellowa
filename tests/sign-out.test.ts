import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Sign-out must be reachable on every device (found in v11, reported by the
 * owner).
 *
 * The defect: the only sign-out control lived in the desktop sidebar, which is
 * `hidden … md:flex`. The mobile bottom nav carried five destinations and no
 * account control, and neither `/you` nor `/settings` offered one. So on a
 * phone — the device this product is actually used on — there was **no way to
 * sign out of Mellowa at all**.
 *
 * That is a privacy defect rather than an inconvenience. Mellowa holds mood,
 * energy, journal and allergy data; on a shared, borrowed or lost phone, being
 * unable to end the session is the whole problem.
 *
 * A 1076-test suite and an eight-state authenticated journey matrix both missed
 * it, because every one of them asserted what a signed-in user can *do* and
 * none asserted they can *stop*.
 */

const nav = readFileSync("src/components/layout/app-nav.tsx", "utf8");
const you = readFileSync("src/app/(app)/you/page.tsx", "utf8");

describe("a signed-in user can sign out on any device", () => {
  it("offers sign-out somewhere that is not desktop-only", () => {
    // The account hub is the surface a user actually looks at for this, and it
    // renders at every width.
    expect(
      you,
      "the You page offers no way to sign out — on mobile there is none at all"
    ).toMatch(/sign out/i);
  });

  it("keeps the desktop sidebar control too", () => {
    expect(nav).toMatch(/Sign out/);
  });

  it("does not hide every sign-out behind a desktop breakpoint", () => {
    // The specific shape of the bug: the sidebar holding the only control is
    // `hidden … md:flex`, so below 768px nothing renders it.
    const sidebarOnly =
      /hidden[^"]*md:flex/.test(nav) && !/sign out/i.test(you);
    expect(
      sidebarOnly,
      "sign-out exists only inside a desktop-only container"
    ).toBe(false);
  });

  it("signs out through Supabase rather than only clearing local state", () => {
    // Clearing a client store without ending the session leaves a valid cookie
    // behind, which looks like a logout and is not one.
    expect(nav).toMatch(/auth\.signOut\(\)/);
  });
});
