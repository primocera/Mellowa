# SEO, social & PWA (Launch v6, Prompt 23)

## What's implemented

- **Canonical + metadataBase**: root `layout.tsx` sets `metadataBase` from
  `NEXT_PUBLIC_APP_URL` (falls back to `https://mellowa.app`). Each public page
  declares its own `alternates.canonical`. No global canonical, so pages don't
  wrongly canonicalize to `/`.
- **robots** (`src/app/robots.ts`): allows `/`, disallows every entry in
  `PRIVATE_PREFIXES` (all `/api/`, authenticated app routes, `/admin`,
  `/auth/`). Points at `/sitemap.xml`.
- **sitemap** (`src/app/sitemap.ts`): public routes only, absolute URLs.
- **Social cards**: `opengraph-image.tsx` renders a 1200×630 branded PNG via
  `next/og` (no binary asset needed); `twitter-image.tsx` reuses it;
  `summary_large_image` Twitter card. Copy is the real product promise — no
  fabricated stats, ratings or testimonials.
- **Structured data**: landing embeds `SoftwareApplication` + `FAQPage`
  JSON-LD, mirroring only on-page claims. No `aggregateRating`/reviews (we have
  none yet).
- **Non-indexable private surfaces**: the `(app)` layout and admin pages set
  `robots: { index: false, follow: false }`.
- **PWA manifest**: installable, standalone. Icons are real binary PNGs
  generated from the brand SVG (MW-V9-09) — `icon-192.png`, `icon-512.png` and
  a padded `icon-maskable-512.png` (`maskable` purpose) — plus the scalable SVG
  as an `any` entry and `apple-touch-icon.png` for iOS. Categories and portrait
  orientation set. Regenerate from `public/mellowa-icon.svg` with `sharp` if the
  brand mark changes.
- **No service worker**: intentionally none. There is no cache that could leak
  one user's data to another session; `tests/seo-pwa.test.ts` guards against a
  caching SW slipping in.

## Known follow-ups (pre-public-launch polish, not blockers)

- ~~**Binary PNG icons** at 192×192 and 512×512~~ — done in MW-V9-09
  (`public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`,
  `apple-touch-icon.png`; validated by `tests/pwa-ui.test.ts`).
- **Core Web Vitals / performance budget**: the project rule is **no CI**
  (GitHub Actions cause email spam), so there is no automated Lighthouse/perf
  gate. Run Lighthouse manually against the deployed public pages before
  launch. Current pages are server-rendered, use `next/font` (self-hosted
  Geist, no external font fetch) and ship minimal client JS (landing is a
  server component; only CTAs and the recap card hydrate).
- **axe / keyboard / reduced-motion** were addressed structurally in Prompt 19
  of Content Elevation (skip link, landmarks, reduced-motion); a manual axe
  pass on the deployed public + key authenticated pages is still recommended.

## Operational

- Set `NEXT_PUBLIC_APP_URL=https://mellowa.app` in Vercel so canonical/OG/robots
  emit the production origin, not a preview domain.
