# DailyFlow AI — Deployment Checklist (Prompt 34)

Production: **https://mellowa.app** (domena zakupljena; Resend wired) · Repo: `primocera/Mellowa` · Vercel projekt: `mellowaa`

## v6 launch gates (Launch & Scale Playbook, julij 2026)
- [ ] Poženi migraciji **020** (idempotency) in **021** (email outbox) v Supabase SQL editorju
- [ ] Supabase → Auth → Redirect URLs: dodaj `https://mellowa.app/auth/callback`
- [ ] Zunanji cron pinger (cron-job.org): `POST https://mellowa.app/api/cron/email-outbox` z `Authorization: Bearer <CRON_SECRET>`, vsakih 10–15 min (glej docs/ops-cron.md)
- [ ] UptimeRobot monitorja: `/api/health` (javno) in `/api/health/ready` (bearer `ADMIN_STATS_SECRET`)
- [ ] `npm run release-check` lokalno s production env (`vercel env pull`); z `APP_URL=https://mellowa.app ADMIN_STATS_SECRET=…` doda live preverbe — nikoli ne izpiše vrednosti
- [ ] Rotiraj SUPABASE_SERVICE_ROLE_KEY (bil deljen v chatu) — Supabase → Settings → API → regenerate, nato posodobi Vercel env
- [ ] Backup restore drill: Supabase → Database → Backups → restore v nov (drugi free) projekt; zabeleži datum/izid
- [ ] Rollback: Vercel → Deployments → Promote prejšnji deploy (en klik); migracije 020/021 sta aditivni (brez drop), rollback koda deluje brez njiju

## ⚠️ TODO ob nakupu domene mellow.app (NE POZABI)
Ko je `mellow.app` zakupljena in vezana na Vercel projekt, popravi na VSEH mestih:
- [ ] Vercel env `NEXT_PUBLIC_APP_URL` → `https://mellow.app` (redeploy!)
- [ ] Supabase → Authentication → URL Configuration → **Site URL** → `https://mellow.app`
- [ ] Supabase → Authentication → URL Configuration → **Redirect URLs** → dodaj `https://mellow.app/**` in `https://mellow.app/reset-password` (stari `mellowaa.vercel.app/**` lahko pustiš zraven dokler ne preveriš da vse dela, potem odstrani)
- [ ] Stripe (novi Mellowa account) → Checkout success/cancel URL uporablja `NEXT_PUBLIC_APP_URL`, torej se popravi samodejno po redeployu — samo preveri po testnem nakupu
- [ ] Stripe → Webhook endpoint URL → `https://mellow.app/api/stripe/webhook` (ali dodaj kot nov endpoint zraven starega, potem izbriši starega)
- [ ] Preveri da forgot-password / reset-password redirect dela na novi domeni (`resetPasswordForEmail` uporablja `window.location.origin`, torej se avtomatsko prilagodi — ni treba spreminjat kode, samo Supabase redirect URL zgoraj)

## Build
- [x] `npm run lint` / `typecheck` / `build` čisti lokalno
- [x] `vercel.json` pinne framework na `nextjs` (projekt je bil ustvarjen kot "Other" → 404; ne odstranjuj!)
- [x] Push na `main` → avtomatski Vercel deploy

## Environment variables (Vercel → Settings → Environment Variables)
| Var | Opomba |
|---|---|
| `NEXT_PUBLIC_APP_URL` | trenutno `https://mellowaa.vercel.app` — zamenjaj ob domeni (glej TODO zgoraj) |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ nastavljen |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ javen po designu, RLS ščiti podatke |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ server-only (`import "server-only"` guard v kodi) |
| `AI_PROVIDER_API_KEY` | ✅ Anthropic |
| `AI_PROVIDER_MODEL` | `claude-haiku-4-5-20251001` |
| `STRIPE_SECRET_KEY` | ⏳ nov ločen Stripe account "Mellowa" (ne ConversionForge) |
| `STRIPE_WEBHOOK_SECRET` | ⏳ iz produkcijskega webhook endpointa |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ⏳ |
| `STRIPE_PRICE_PRO_MONTHLY` / `_YEARLY` | ⏳ price ID-ja iz Stripe products (USD-first $12.99/mo, $129.99/yr; EU/EEA €11.99/€119.99 preko currency_options) |

## Supabase
- [x] Migracija `supabase/migrations/001_initial_schema.sql` pognana
- [x] Migracija `supabase/migrations/002_mellowa_v2_trial.sql` pognana (trial_start/trial_end/cancel_at_period_end)
- [x] Auto-RLS event trigger enablan
- [x] Auth → URL Configuration: redirect za `/reset-password` dodan (na trenutni mellowaa.vercel.app domeni)
- [ ] Auth → Email: "Confirm email" izklopljen za beta (vklopi + SMTP pred javnim launchom)
- [ ] **Ponovi redirect URL korak ko se domena zamenja** (glej TODO na vrhu)

## Stripe (ko prideš do plačil — SKUPAJ z domeno, glej dogovor)
1. **Nov ločen Stripe account "Mellowa"** (Create separate account, NE isto kot ConversionForge) — čist branding, keyi, webhook
2. Product "Mellowa Premium": monthly $12.99 + yearly $129.99 (USD-first; EU/EEA €11.99/€119.99 preko currency_options) → price ID-ja v env
3. Webhook endpoint `https://mellow.app/api/stripe/webhook` (ali začasno `https://mellowaa.vercel.app/api/stripe/webhook` če greš prej), eventi: `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.payment_failed`, `invoice.payment_succeeded`
4. Signing secret → `STRIPE_WEBHOOK_SECRET` → redeploy
5. Lokalni test: `stripe listen --forward-to localhost:3000/api/stripe/webhook`

## Production safety checklist
- [x] Service role in Stripe secret nikoli v client bundlu (server-only guard)
- [x] Safety classifier fail-closed
- [x] Quality gate na daily planih (banned language + gostota)
- [x] RLS na vseh tabelah
- [ ] Rotiraj Supabase service role key pred javnim launchom (bil deljen med devom)
- [ ] Vklopi email confirmation + custom SMTP
- [ ] Razmisli o rate limitu na AI route
