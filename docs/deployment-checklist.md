# DailyFlow AI — Deployment Checklist (Prompt 34)

Production: **https://mellowaa.vercel.app** · Repo: `primocera/Mellowa` · Vercel projekt: `mellowaa`

## Build
- [x] `npm run lint` / `typecheck` / `build` čisti lokalno
- [x] `vercel.json` pinne framework na `nextjs` (projekt je bil ustvarjen kot "Other" → 404; ne odstranjuj!)
- [x] Push na `main` → avtomatski Vercel deploy

## Environment variables (Vercel → Settings → Environment Variables)
| Var | Opomba |
|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://mellowaa.vercel.app` — EN URL, brez vejic |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ nastavljen |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ javen po designu, RLS ščiti podatke |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ server-only (`import "server-only"` guard v kodi) |
| `AI_PROVIDER_API_KEY` | ✅ Anthropic |
| `AI_PROVIDER_MODEL` | `claude-haiku-4-5-20251001` |
| `STRIPE_SECRET_KEY` | ⏳ ko aktiviraš plačila |
| `STRIPE_WEBHOOK_SECRET` | ⏳ iz produkcijskega webhook endpointa |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ⏳ |
| `STRIPE_PRICE_PRO_MONTHLY` / `_YEARLY` | ⏳ price ID-ja iz Stripe products |

## Supabase
- [ ] Migracija `supabase/migrations/001_initial_schema.sql` pognana v SQL Editorju
- [x] Auto-RLS event trigger enablan
- [ ] Auth → URL Configuration: Site URL = produkcijski URL, redirect `https://mellowaa.vercel.app/**` + `http://localhost:3000/**`
- [ ] Auth → Email: "Confirm email" izklopljen za beta (vklopi + SMTP pred javnim launchom)

## Stripe (ko prideš do plačil)
1. Product "DailyFlow Premium": monthly $9 + yearly $79 → price ID-ja v env
2. Webhook endpoint `https://mellowaa.vercel.app/api/stripe/webhook`, eventi: `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.payment_failed`
3. Signing secret → `STRIPE_WEBHOOK_SECRET` → redeploy
4. Lokalni test: `stripe listen --forward-to localhost:3000/api/stripe/webhook`

## Production safety checklist
- [x] Service role in Stripe secret nikoli v client bundlu (server-only guard)
- [x] Safety classifier fail-closed
- [x] Quality gate na daily planih (banned language + gostota)
- [x] RLS na vseh 12 tabelah
- [ ] Rotiraj Supabase service role key pred javnim launchom (bil deljen med devom)
- [ ] Vklopi email confirmation + custom SMTP
- [ ] Razmisli o rate limitu na AI route
