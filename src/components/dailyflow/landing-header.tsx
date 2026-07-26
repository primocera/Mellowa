"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

/**
 * The public landing header (MW-V11-02).
 *
 * History worth knowing before changing this. MW-V10-07 found the nav links
 * were 20px tall — below even the WCAG 2.2 AA minimum — and fixed it by giving
 * every link a 44px box. That made the row too *wide* for a 320px phone, the
 * flex container wrapped, and the nav dropped under the wordmark. The owner
 * rejected that on sight and the header was reverted to its v9 form, with the
 * public 44px test amended to skip anything inside `<header>`. So the targets
 * were never fixed; they were made invisible to the test.
 *
 * The resolution here starts from what actually caused the wrap: **height is
 * free, width is not.** A 44px-tall target costs nothing horizontally, so every
 * control keeps a full 44px box with minimal horizontal padding. What genuinely
 * does not fit on a 320px screen is the *number* of links, and that is solved
 * by a disclosure rather than by shrinking targets or hiding pricing.
 *
 * Accessibility contract, stated rather than implied:
 *  - Every header target is ≥44×44 CSS px — WCAG 2.2 SC 2.5.5 (AAA), the same
 *    rule the rest of the public pages are held to. There is no exemption.
 *  - The row never wraps at any supported width (320px → 1440px, and 200% zoom).
 *  - Below 640px the two secondary links move into one disclosure. Nothing is
 *    removed: every destination stays reachable, and the menu button states its
 *    expanded state, names its controlled region, closes on Escape and on an
 *    outside click, and returns focus to itself when it closes.
 *  - No focus trap. This is a disclosure, not a modal; trapping focus in a
 *    four-link menu is hostile to keyboard users.
 */

/**
 * Every header control: a 44px box, minimal horizontal padding.
 *
 * Deliberately carries **no display utility**. It used to start with
 * `inline-flex`, which silently defeated the `hidden` on the secondary links —
 * both are base-layer display utilities, so the one Tailwind emits later wins
 * regardless of class order, and every link rendered at 320px. Display is set
 * per element below, where the responsive intent is visible.
 */
const HEADER_TARGET =
  "min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-sm " +
  "transition focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-[#7C9A92] focus-visible:ring-offset-2";

const NAV_LINK = HEADER_TARGET + " px-2 text-[#6B7280] hover:text-[#1F2937]";

/**
 * Secondary navigation. Genuinely secondary: both destinations are also
 * reachable from the page body and the footer. Sign-in and the sample CTA are
 * never in here.
 */
const SECONDARY_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
] as const;

export function LandingHeader() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Escape closes and hands focus back, so a keyboard user is never left
  // somewhere they cannot see.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    // flex-nowrap is load-bearing: the wrap it prevents is the exact regression
    // that caused this component to exist.
    <header className="mx-auto flex max-w-5xl flex-nowrap items-center justify-between gap-1 px-3 py-3 sm:gap-2 sm:px-6 sm:py-4">
      <Link
        href="/"
        className={
          HEADER_TARGET +
          " inline-flex px-1 text-base font-semibold tracking-tight text-[#1F2937] sm:text-lg"
        }
      >
        Mellowa
      </Link>

      <div ref={containerRef} className="relative flex flex-nowrap items-center gap-1 sm:gap-2">
        {/* ≥640px: the secondary links sit inline and the disclosure is gone. */}
        {SECONDARY_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className={NAV_LINK + " hidden sm:inline-flex"}>
            {/* hidden below 640px; the disclosure below carries these two. */}
            {link.label}
          </Link>
        ))}

        {/* <640px: one disclosure for the same two destinations. */}
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          className={
            HEADER_TARGET + " inline-flex px-2 text-[#6B7280] hover:text-[#1F2937] sm:hidden"
          }
        >
          Menu
        </button>

        <Link href="/login" className={NAV_LINK + " inline-flex"}>
          Sign in
        </Link>

        {/*
          One destination, two label lengths. A 320px row cannot hold the
          wordmark, a disclosure, sign-in and a sixteen-character CTA without
          either wrapping or shrinking a target below 44px, and both of those
          are the defects this component exists to prevent. `hidden` removes the
          unused label from the accessibility tree, so the accessible name is
          always exactly what is on screen — never both at once.
        */}
        <Link
          href="/signup"
          className={
            HEADER_TARGET +
            " inline-flex bg-[#7C9A92] px-3 font-medium text-white hover:bg-[#6D8C7D] sm:px-4"
          }
        >
          <span className="min-[400px]:hidden">Free sample</span>
          <span className="hidden min-[400px]:inline">Create my sample</span>
        </Link>

        {/*
          Rendered only when open, so a closed menu holds no focusable element
          and cannot be tabbed into invisibly. A border rather than a shadow
          alone, so the panel still has an edge in forced-colors mode.
        */}
        {open && (
          <div
            id={panelId}
            className="absolute right-0 top-full z-20 mt-1 flex w-48 flex-col rounded-xl border border-[#E5E1DA] bg-white p-1 shadow-md sm:hidden"
          >
            {SECONDARY_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={NAV_LINK + " flex w-full justify-start px-3"}
              >
                {link.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
