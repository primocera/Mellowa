import { test, expect } from "@playwright/test";

/**
 * Public-surface smoke suite (Prompt 18). Runs without any external service:
 * marketing page, pricing disclosures, legal pages, auth forms including the
 * age/consent gate, and basic layout hygiene on mobile.
 */

test("home page renders with safety boundary and legal links", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Mellowa/i);
  await expect(page.locator("footer")).toContainText(/not medical care/i);
  for (const path of ["/privacy", "/terms", "/refund"]) {
    await expect(page.locator(`footer a[href="${path}"]`)).toBeVisible();
  }
});

test("no horizontal overflow on mobile", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  expect(overflow).toBe(false);
});

test("pricing shows exact prices and payment disclosure near CTA", async ({ page }) => {
  await page.goto("/pricing");
  // USD-primary catalog (MW-02): the anonymous, non-EU test visitor is quoted
  // USD. Old €9.99/€59.99 literals were removed with the dual-currency work.
  await expect(page.getByText("$12.99/month").first()).toBeVisible();
  await expect(page.getByText("$129.99/year").first()).toBeVisible();
  await expect(page.getByText(/payment method required/i).first()).toBeVisible();
  // No absolute "unlimited" promise (fair-use copy instead).
  await expect(page.locator("body")).not.toContainText(/unlimited personalized/i);
});

/**
 * MW-V10-02: an anonymous visitor is not assigned a cohort, so no public page
 * may claim a trial length checkout would not honour. What is asserted is what
 * holds in every configuration:
 *
 * - Pricing is internally consistent — one length across headline, CTA and
 *   footnote, plus a concrete cancel-by date — or it names no length at all and
 *   promises the exact figures before checkout.
 * - No public page ever shows an unassigned visitor the 7-day arm's length.
 * - "Free week" appears nowhere; it would only be true for a real 7-day grant.
 *
 * Cross-page equality with /terms and /refund is deliberately NOT asserted:
 * those are statically prerendered, so their wording is fixed by the build that
 * produced them. On Vercel that is safe — an env change reaches only a new
 * deployment, which re-renders them — but injecting the flag into an already
 * built server would legitimately leave them on the build's wording.
 */
test("anonymous trial disclosure never claims an unassigned length", async ({
  page,
}) => {
  await page.goto("/pricing");
  const pricingBody = (await page.locator("body").innerText()).toLowerCase();
  const named = pricingBody.match(/(\d+) days? free/);

  if (named) {
    for (const m of pricingBody.matchAll(/(\d+) days? free/g)) {
      expect(m[1]).toBe(named[1]);
    }
    await expect(page.getByText(/cancel before/i).first()).toBeVisible();
  } else {
    // Length unknown: the page must promise it before checkout, not guess.
    await expect(
      page.getByText(/shown before checkout|exact trial length/i).first()
    ).toBeVisible();
  }

  for (const path of ["/pricing", "/terms", "/refund", "/"]) {
    await page.goto(path);
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body, `${path} implies a week-long trial`).not.toMatch(
      /free week|week free|7 days|7-day/
    );
  }
});

/**
 * MW-V10-07: the public surfaces at the width and input methods people actually
 * use. Runs in all three viewport projects, so 320px is covered by the same
 * assertions rather than a separate resize test.
 */
test("public routes are usable without a pointer and without horizontal scroll", async ({
  page,
}) => {
  for (const path of ["/", "/pricing", "/signup", "/login", "/terms"]) {
    await page.goto(path);

    // No layout wider than the viewport, at any of the three widths.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1
    );
    expect(overflow, `${path} scrolls horizontally`).toBe(false);

    // Exactly one h1: a screen-reader user needs one page title, not zero or six.
    const h1s = await page.locator("h1").count();
    expect(h1s, `${path} has ${h1s} h1 elements`).toBe(1);

    // A main landmark to skip to.
    expect(await page.locator("main, [role=main]").count(), path).toBeGreaterThan(0);
  }
});

test("every interactive control on the public pages is at least 44px tall", async ({
  page,
}) => {
  for (const path of ["/", "/pricing", "/signup"]) {
    await page.goto(path);
    // MW-V11-02: the header exemption that used to sit here is gone. The header
    // is held to the same rule as every other control on the page, and the
    // dedicated header tests below assert geometry and behaviour across
    // breakpoints. An exemption made a real surface invisible to its own test.
    const controls = page.locator(
      "button:visible, a[href]:visible, input:visible:not([type=hidden])"
    );
    const n = await controls.count();
    const tooSmall: string[] = [];
    for (let i = 0; i < n; i++) {
      const el = controls.nth(i);
      const box = await el.boundingBox();
      if (!box || box.height === 0) continue;
      // Two documented exemptions, both measured rather than assumed:
      //  - inline text links inside a paragraph inherit line height by design,
      //    and forcing 44px would break body copy;
      //  - a checkbox/radio's real target is its wrapping <label>, because
      //    tapping the text toggles it — so the LABEL's height is what counts.
      const effectiveHeight = await el.evaluate((node) => {
        const tag = node.tagName.toLowerCase();
        const parent = node.parentElement;
        const parentTag = parent?.tagName.toLowerCase() ?? "";
        if (tag === "a" && ["p", "li", "span"].includes(parentTag)) return null;
        const type = node.getAttribute("type");
        if (tag === "input" && (type === "checkbox" || type === "radio")) {
          const label = node.closest("label");
          if (label) return label.getBoundingClientRect().height;
        }
        return node.getBoundingClientRect().height;
      });
      if (effectiveHeight === null) continue;
      if (effectiveHeight < 44) {
        const label =
          (await el.innerText().catch(() => "")) ||
          (await el.getAttribute("aria-label")) ||
          (await el.getAttribute("name")) ||
          (await el.evaluate((n) => n.tagName.toLowerCase()));
        tooSmall.push(`${label} (${Math.round(effectiveHeight)}px)`);
      }
    }
    expect(tooSmall, `${path} has controls under 44px: ${tooSmall.join(", ")}`).toEqual([]);
  }
});

/**
 * MW-V11-02: the header accessibility contract, asserted rather than exempted.
 *
 * The rule this encodes: every header target is ≥44×44 CSS px (WCAG 2.2
 * SC 2.5.5), the row never wraps at any supported width, and nothing essential
 * is removed to achieve either. The previous arrangement satisfied the second
 * requirement by abandoning the first and hiding the header from the test.
 *
 * Widths are checked explicitly instead of relying on the project viewports, so
 * one run covers the whole supported range including the 200% zoom case.
 */
const HEADER_WIDTHS = [320, 360, 375, 768, 1024, 1440];

test("every header target meets 44px at every supported width", async ({ page }) => {
  const failures: string[] = [];

  for (const width of HEADER_WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");

    const targets = page.locator("header a[href], header button");
    const count = await targets.count();
    expect(count, `${width}px: header has no targets`).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const target = targets.nth(i);
      if (!(await target.isVisible())) continue;
      const box = await target.boundingBox();
      if (!box) continue;
      const label = (await target.innerText()).trim() || "(unlabelled)";
      if (box.height < 44 || box.width < 44) {
        failures.push(
          `${width}px: "${label}" is ${Math.round(box.width)}×${Math.round(box.height)}`
        );
      }
    }
  }

  expect(failures, `header targets under 44px: ${failures.join("; ")}`).toEqual([]);
});

test("the header stays on one row and never overflows", async ({ page }) => {
  for (const width of HEADER_WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");

    const targets = page.locator("header a[href]:visible, header button:visible");
    const boxes = (await targets.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, text: node.textContent?.trim() ?? "" };
      })
    )) as { top: number; bottom: number; text: string }[];

    expect(boxes.length, `${width}px: no visible header targets`).toBeGreaterThan(0);

    // One row = every target's vertical span overlaps every other's. This
    // catches a wrap without caring how the layout was written.
    const first = boxes[0];
    for (const box of boxes) {
      const overlaps = box.top < first.bottom && box.bottom > first.top;
      expect(
        overlaps,
        `${width}px: "${box.text}" wrapped onto a second row`
      ).toBe(true);
    }

    // No horizontal overflow anywhere on the page at this width.
    const scrollWidth = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(
      scrollWidth.doc,
      `${width}px: page scrolls horizontally (${scrollWidth.doc} > ${scrollWidth.client})`
    ).toBeLessThanOrEqual(scrollWidth.client + 1);
  }
});

test("the header survives 200% zoom without wrapping or clipping", async ({ page }) => {
  // 200% zoom on a 1280px screen presents as a 640px viewport to the layout.
  await page.setViewportSize({ width: 640, height: 512 });
  await page.goto("/");

  const targets = page.locator("header a[href]:visible, header button:visible");
  const boxes = (await targets.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, right: rect.right, text: node.textContent?.trim() ?? "" };
    })
  )) as { top: number; bottom: number; right: number; text: string }[];

  const first = boxes[0];
  for (const box of boxes) {
    expect(box.top < first.bottom && box.bottom > first.top, `"${box.text}" wrapped at 200% zoom`).toBe(true);
    expect(box.right, `"${box.text}" is clipped at 200% zoom`).toBeLessThanOrEqual(641);
  }
});

test("pricing, sign-in and sample access stay reachable at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");

  // Primary action and account access are always visible — never behind a menu.
  await expect(page.locator('header a[href="/signup"]')).toBeVisible();
  await expect(page.locator('header a[href="/login"]')).toBeVisible();

  // Pricing is reachable through the disclosure, not removed. The inline copy
  // of the link also exists in the DOM at this width but is display:none, so
  // assert on the visible one specifically.
  const menu = page.locator("header button");
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('header a[href="/pricing"]:visible')).toHaveCount(0);
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('header a[href="/pricing"]:visible')).toHaveCount(1);
});

test("the header disclosure is operable by keyboard and closes predictably", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");

  const menu = page.locator("header button");
  const panelId = await menu.getAttribute("aria-controls");
  expect(panelId, "menu button does not name the region it controls").toBeTruthy();

  // Opens from the keyboard.
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(`#${panelId}`)).toBeVisible();

  // Escape closes it AND returns focus to the button, so a keyboard user is
  // never left focused on something that no longer exists.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(`#${panelId}`)).toHaveCount(0);
  await expect(menu).toBeFocused();

  // An outside click closes it too.
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await page.locator("main").click({ position: { x: 5, y: 5 } });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
});

test("the header exposes literal accessible names at every width", async ({ page }) => {
  // Wide: every label is inline, no disclosure. Viewport is set explicitly so
  // this asserts the same thing in all three projects.
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto("/");
  const header = page.locator("header");
  for (const name of [/how it works/i, /pricing/i, /sign in/i, /create my sample/i]) {
    await expect(header.getByRole("link", { name }).first()).toBeVisible();
  }
  // The disclosure exists in the DOM but must not be shown when every link is
  // already inline — two competing navigations is the failure mode here.
  await expect(page.locator("header button")).not.toBeVisible();
  await expect(page.locator('header a[href="/"]')).toBeVisible();

  // Narrow: the two secondary labels move into the disclosure, and the CTA
  // shortens. No icon-only control appears at any width — every target still
  // carries readable text.
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await expect(header.getByRole("link", { name: /free sample/i })).toBeVisible();
  await expect(header.getByRole("link", { name: /sign in/i })).toBeVisible();
  await expect(header.getByRole("button", { name: /menu/i })).toBeVisible();

  const targets = page.locator("header a[href]:visible, header button:visible");
  const labels = await targets.evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLElement).innerText.trim())
  );
  expect(labels.every((label) => label.length > 0), `unlabelled target: ${labels.join("|")}`).toBe(
    true
  );

  await header.getByRole("button", { name: /menu/i }).click();
  await expect(header.getByRole("link", { name: /how it works/i })).toBeVisible();
  await expect(header.getByRole("link", { name: /pricing/i })).toBeVisible();
});

/**
 * MW-V11-03: the adaptation proof. It is an illustration, so the things that
 * can go wrong with it are layout and honesty, not behaviour.
 */
test("the adaptation proof renders truthfully and fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/#how-it-works");

  const figure = page.locator("figure").first();
  await expect(figure).toBeVisible();

  // innerText applies text-transform, so the step labels come back uppercased.
  // Compare case-insensitively: the assertion is about wording, not casing.
  const text = (await figure.innerText()).replace(/\s+/g, " ").toLowerCase();

  // The beats of the loop, in the product's own words.
  for (const beat of [
    "today · one next step",
    "then the day changes",
    "what will change",
    "rest of today adjusted",
    "undo — bring the previous plan back",
  ]) {
    expect(text, `proof is missing "${beat}"`).toContain(beat);
  }

  // It says what it is. A product screenshot that could be read as a customer
  // result is the failure mode worth a test.
  expect(text).toContain("example of the product view");
  expect(text).toContain("not a customer result");

  // No fake controls: nothing inside the illustration is focusable.
  expect(await figure.locator("button, a[href], input").count()).toBe(0);

  // Fits 320px without its own scrollbar.
  const overflows = await figure.evaluate(
    (node) => node.scrollWidth > node.clientWidth + 1
  );
  expect(overflows, "the proof overflows a 320px screen").toBe(false);
});

test("focus is visible on the primary signup control", async ({ page }) => {
  await page.goto("/signup");
  const email = page.locator('input[type="email"]');
  await email.focus();
  const outlined = await email.evaluate((el) => {
    const s = getComputedStyle(el);
    // Either a real outline or a ring shadow counts; "none/none" does not.
    return s.outlineStyle !== "none" || s.boxShadow !== "none";
  });
  expect(outlined, "focused input has no visible focus indicator").toBe(true);
});

test("signup requires 18+ and policy consent (not pre-checked)", async ({ page }) => {
  await page.goto("/signup");
  const checkboxes = page.locator('input[type="checkbox"]');
  await expect(checkboxes).toHaveCount(2);
  for (const box of await checkboxes.all()) {
    await expect(box).not.toBeChecked();
  }
  // Terms/Privacy links visible next to consent.
  await expect(page.locator('a[href="/terms"]').first()).toBeVisible();
  await expect(page.locator('a[href="/privacy"]').first()).toBeVisible();

  await page.fill('input[type="email"]', "person@example.com");
  await page.fill('input[type="password"]', "longenoughpassword");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page.getByText(/confirm you are 18/i)).toBeVisible();
});

test("login offers forgot-password recovery", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('a[href="/forgot-password"]')).toBeVisible();
});

test("privacy policy lists processors and retention", async ({ page }) => {
  await page.goto("/privacy");
  for (const provider of ["Anthropic", "Stripe", "Resend", "Supabase", "Vercel"]) {
    await expect(page.getByText(provider).first()).toBeVisible();
  }
  await expect(page.getByText(/retention/i).first()).toBeVisible();
});

test("legal pages have no placeholder lorem or broken headings", async ({ page }) => {
  for (const path of ["/terms", "/refund", "/privacy"]) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/lorem ipsum|TODO|\[placeholder\]/i);
  }
});

test("keyboard navigation reaches the primary signup CTA", async ({ page }) => {
  await page.goto("/signup");
  await page.keyboard.press("Tab");
  const active = await page.evaluate(() => document.activeElement?.tagName ?? "");
  expect(["A", "INPUT", "BUTTON"]).toContain(active);
});

test("verify-email page shows next step, resend and change-email", async ({ page }) => {
  await page.goto("/verify-email?email=person%40example.com");
  await expect(page.getByText(/check your email to continue/i)).toBeVisible();
  await expect(page.getByText("person@example.com")).toBeVisible();
  await expect(page.getByRole("button", { name: /resend email/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /use a different email/i })).toBeVisible();
});

test("auth callback rejects a missing code and a malicious next URL", async ({ page }) => {
  await page.goto("/auth/callback?next=https%3A%2F%2Fevil.com");
  await expect(page).toHaveURL(/\/login\?error=verify_link_invalid/);
  // Never leaves the origin.
  expect(new URL(page.url()).hostname).not.toContain("evil.com");
});

test("hero leads with the free-sample funnel, not a trial promise", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: /create my free sample plan/i }).first()).toBeVisible();
  await expect(page.getByText(/no payment card is requested/i).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/start my 3-day free trial/i);
});

/**
 * MW-V11-01: rendered commercial copy.
 *
 * These assertions exist because the defects they catch were live while a
 * 900-test suite was green. A contract test can prove a helper returns the
 * right string; only a render can prove the page puts a space between two of
 * them. The hero really did read "…the day you actually have.Tell Mellowa…".
 */
test("public commercial copy is grammatical and spaced in the browser", async ({
  page,
}) => {
  for (const path of ["/", "/pricing", "/refund", "/terms"]) {
    await page.goto(path);
    const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");

    // A sentence-ending period glued to the next sentence's capital letter.
    // Scoped to a lowercase letter before the period so abbreviations and
    // decimals ("€9.99", "e.g.") are not swept up.
    const glued = text.match(/[a-z]{2}\.[A-Z][a-z]/g) ?? [];
    expect(glued, `${path} renders sentences with no space: ${glued.join(", ")}`).toEqual(
      [],
    );

    // The plural noun form used attributively, e.g. "a 3 days trial".
    expect(text, `${path} renders an ungrammatical trial length`).not.toMatch(
      /\ba \d+ days\b/i,
    );
    expect(text, `${path} renders an ungrammatical trial length`).not.toMatch(
      /\d+ days trial/i,
    );
  }
});

test("the hero states the sample terms once, not twice", async ({ page }) => {
  await page.goto("/");
  const hero = (await page.locator("main section").first().innerText()).replace(
    /\s+/g,
    " ",
  );
  // Both facts a visitor needs before clicking, each stated exactly once.
  expect((hero.match(/no payment card|no card|without a card/gi) ?? []).length).toBe(1);
  expect((hero.match(/account is required/gi) ?? []).length).toBe(1);
});

test("signup and login pages carry the elevated account copy", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByText(/create your mellowa account/i)).toBeVisible();
  await expect(page.getByText(/no payment method until you choose premium/i)).toBeVisible();
  await expect(page.getByText(/use at least 8 characters/i)).toBeVisible();
  await page.goto("/login");
  await expect(page.getByText(/welcome back/i)).toBeVisible();
});
