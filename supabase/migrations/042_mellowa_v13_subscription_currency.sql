-- MW-V13: store the currency a subscription is actually charged in.
--
-- Mellowa is USD-first with an EUR region price (Scalvya-style). The webhook now
-- reads the real charged currency from the Stripe price object and stores it
-- here, so trial/renewal emails and the billing page can show the buyer their
-- own currency instead of the USD default. Receipts already format the real
-- Stripe currency; this backs the pre-charge disclosures too.
--
-- Additive and nullable: existing rows read NULL and callers fall back to USD.
-- The webhook backfills each row on the next subscription event. Re-runnable.
alter table public.subscriptions
  add column if not exists currency text;

comment on column public.subscriptions.currency is
  'ISO currency (e.g. usd, eur) the subscription is charged in, from the Stripe '
  'price. NULL for rows written before this column existed; callers fall back to '
  'the USD default. Written by the Stripe webhook on every subscription event.';
