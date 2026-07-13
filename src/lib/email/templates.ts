import { serverEnv } from "@/lib/env";

/**
 * Lifecycle email templates. Calm, warm, non-clinical — matching Mellowa's
 * tone. Plain inline-styled HTML so it renders in every email client.
 */

const BRAND = "#6D8C7D";
const TEXT = "#1F2937";
const MUTED = "#6B7280";

function shell(bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#FAF7F2;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${TEXT};">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;">
    <div style="font-size:20px;font-weight:600;letter-spacing:-0.02em;margin-bottom:20px;">Mellowa</div>
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #EDE9E2;margin:28px 0 16px;" />
    <p style="font-size:12px;color:${MUTED};line-height:1.6;margin:0;">
      Mellowa is a wellbeing app — not medical care, therapy or emergency support.
      If you're in crisis, please contact your local emergency services.
    </p>
  </div>
</body></html>`;
}

function button(label: string, href: string): string {
  return `<a href="${href}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600;font-size:15px;">${label}</a>`;
}

const appUrl = () => serverEnv.appUrl;

export function welcomeEmail(): { subject: string; html: string } {
  return {
    subject: "Welcome to Mellowa 🌿",
    html: shell(`
      <p style="font-size:16px;line-height:1.6;">Hi there,</p>
      <p style="font-size:16px;line-height:1.6;">
        Welcome to Mellowa. We're here to help you build a simple, gentle daily
        rhythm for food, energy, mood and habits — no strict rules, no pressure.
      </p>
      <p style="font-size:16px;line-height:1.6;">
        Start with a quick check-in and we'll shape today's plan around how you
        actually feel.
      </p>
      <p style="margin:24px 0;">${button("Create today's plan", `${appUrl()}/today`)}</p>
      <p style="font-size:14px;color:${MUTED};line-height:1.6;">Take it one small step at a time. 🌱</p>
    `),
  };
}

export function trialStartedEmail(daysLeft: number): { subject: string; html: string } {
  return {
    subject: "Your Mellowa trial has started",
    html: shell(`
      <p style="font-size:16px;line-height:1.6;">Your 3-day free trial is now active.</p>
      <p style="font-size:16px;line-height:1.6;">
        You have full access to personalized daily plans, meal ideas, movement
        moments and calm resets. You won't be charged until the trial ends
        (about ${daysLeft} day${daysLeft === 1 ? "" : "s"} from now), and you can
        cancel any time from your billing settings.
      </p>
      <p style="margin:24px 0;">${button("Open Mellowa", `${appUrl()}/today`)}</p>
    `),
  };
}

export function trialEndingEmail(): { subject: string; html: string } {
  return {
    subject: "Your Mellowa trial ends soon",
    html: shell(`
      <p style="font-size:16px;line-height:1.6;">A gentle heads-up 🌿</p>
      <p style="font-size:16px;line-height:1.6;">
        Your free trial ends tomorrow. If Mellowa is helping, you don't need to do
        anything — your subscription will continue automatically so your daily
        rhythm keeps going.
      </p>
      <p style="font-size:16px;line-height:1.6;">
        Not the right fit right now? You can cancel any time before then and won't
        be charged.
      </p>
      <p style="margin:24px 0;">${button("Manage billing", `${appUrl()}/billing`)}</p>
    `),
  };
}

export function trialEndedEmail(): { subject: string; html: string } {
  return {
    subject: "Welcome to Mellowa premium 🌿",
    html: shell(`
      <p style="font-size:16px;line-height:1.6;">Your trial has ended and your subscription is active.</p>
      <p style="font-size:16px;line-height:1.6;">
        Thank you for continuing with Mellowa. Everything stays exactly where you
        left it — keep building your gentle daily rhythm.
      </p>
      <p style="margin:24px 0;">${button("Open Mellowa", `${appUrl()}/today`)}</p>
    `),
  };
}

export function paymentFailedEmail(): { subject: string; html: string } {
  return {
    subject: "We couldn't process your Mellowa payment",
    html: shell(`
      <p style="font-size:16px;line-height:1.6;">We had trouble processing your latest payment.</p>
      <p style="font-size:16px;line-height:1.6;">
        No stress — this usually just means a card needs updating. Please update
        your payment details so your access continues without interruption.
      </p>
      <p style="margin:24px 0;">${button("Update payment", `${appUrl()}/billing`)}</p>
    `),
  };
}
