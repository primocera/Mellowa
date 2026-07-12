import "server-only";
import Stripe from "stripe";
import { serverEnv } from "@/lib/env";

/** SERVER-ONLY Stripe client. Never import from client components. */
let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripe) {
    stripe = new Stripe(serverEnv.stripeSecretKey);
  }
  return stripe;
}
