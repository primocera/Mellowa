-- Prompt 3 (audit v5): robust out-of-order webhook protection.
-- Stores the Stripe event `created` timestamp of the last applied
-- subscription sync; older events are ignored instead of relying on
-- period_end comparison alone.

alter table public.subscriptions
  add column if not exists last_stripe_event_created bigint;
