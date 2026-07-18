import type Stripe from "stripe";
import type { BillingFacts } from "@/lib/email/templates";

/**
 * Derive exact, human billing facts from Stripe objects for lifecycle emails
 * (Content Elevation v6, Prompt 17). Every value is optional: when a field is
 * missing the templates fall back to a truthful sentence rather than an
 * invented number.
 */

export function formatMoney(
  amountMinor: number | null | undefined,
  currency: string | null | undefined
): string | undefined {
  if (amountMinor == null || !currency) return undefined;
  try {
    return new Intl.NumberFormat("en-IE", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amountMinor / 100);
  } catch {
    return undefined;
  }
}

export function formatDate(epochSeconds: number | null | undefined): string | undefined {
  if (!epochSeconds) return undefined;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(epochSeconds * 1000));
}

function planLabel(interval: string | undefined): string | undefined {
  if (interval === "year") return "Yearly plan";
  if (interval === "month") return "Monthly plan";
  return undefined;
}

/**
 * `whichDate` selects the relevant date for the email: the trial end for
 * trial-started/ending, or the period end for a cancellation.
 */
export function factsFromSubscription(
  sub: Stripe.Subscription,
  whichDate: "trial_end" | "period_end" = "trial_end"
): BillingFacts {
  const item = sub.items?.data?.[0];
  const price = item?.price;
  const epoch =
    whichDate === "trial_end" ? sub.trial_end : item?.current_period_end;
  return {
    plan: planLabel(price?.recurring?.interval),
    price: formatMoney(price?.unit_amount, price?.currency),
    date: formatDate(epoch),
  };
}

export function factsFromInvoice(invoice: Stripe.Invoice): BillingFacts {
  // Invoice line items don't reliably expose the recurring interval across
  // API versions, so we surface the exact amount and omit the plan label.
  return {
    price: formatMoney(invoice.amount_due, invoice.currency),
  };
}
