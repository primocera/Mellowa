# Localization & content accessibility (Content Elevation v6, Prompt 19)

Mellowa ships in English today. This document defines how the elevated copy
stays accessible and ready for future translation without a rewrite.

## Content inventory & message IDs

- The stable message-ID catalog lives in `src/lib/i18n/messages.ts`.
- IDs are namespaced (`area.key`) and **stable** — never renumber or reuse an
  ID, even if the English text changes.
- Future locales key off the ID, not the English string. Until locales land,
  `message(id)` returns the English source and components may still render
  English literals; the catalog is the migration target and the audit surface.

## Locale-aware formatting

- Dates, prices, decimal separators and pluralization use `Intl` at render
  time. See `formatMoney` / `formatDate` in `src/lib/email/billing-facts.ts`.
- **Never** bake a currency symbol, date format or hard-coded plural into a
  translatable string. Format the value, then interpolate.

## Safety & legal are locked

- Safety, crisis, medical-boundary and legal/billing-truth copy is **locked**
  (`LOCALIZATION_LOCKED` in `messages.ts`). It must be **human-translated and
  reviewed per locale** — never machine-translated, and never shipped with a
  locale only partially translated. A missing translation falls back to the
  reviewed English rather than an auto-translation.

## Accessibility rules the copy must keep

- Every CTA names its action with an explicit verb, so it is unambiguous when
  a screen reader announces the button name alone (e.g. "Shape today's plan",
  "Update payment method", "Confirm cancellation").
- Essential meaning is never placeholder-only. Placeholders are examples; the
  label/helper carries the requirement.
- Live-region messages (loading, success, error) come from the microcopy map
  (`src/lib/microcopy/errors.ts`) so they are consistent and translatable.
- Copy must wrap cleanly at 320/375px and tolerate 30–40% string expansion at
  200% zoom. Prefer flexible layouts over fixed-width text.

## Migration path

1. Extend `MESSAGES` as strings are elevated (keep IDs stable).
2. Add a locale file per language keyed by ID.
3. Route locked IDs through human translation review before enabling a locale.
4. Keep `Intl`-based formatting for all numbers, money and dates.
