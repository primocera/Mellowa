/**
 * Support-timing content contract (MW-V17-09).
 *
 * "Paid support replies within 2 business days" read as a guaranteed SLA, but no
 * monitored inbox with a business calendar, backup owner and escalation operates
 * behind it. Customer-facing timing is therefore best-effort, driven from HERE so
 * every surface (Help, Settings, lifecycle/contact) says the same thing and a
 * change is one edit.
 *
 * To promise a guaranteed reply time, an owner must FIRST stand up a monitored
 * inbox + business calendar + backup owner + triage/escalation + measurement that
 * can sustain it, THEN flip `SUPPORT_SLA_GUARANTEED` to true. Until then the copy
 * never implies a guarantee, and it never exposes internal support capacity.
 */

/** Flip to true only once a real, sustainable support operation exists. */
export const SUPPORT_SLA_GUARANTEED = false;

/** The single customer-facing reply-time sentence. */
export const SUPPORT_REPLY_COPY = SUPPORT_SLA_GUARANTEED
  ? "Paid support replies within two business days."
  : "We aim to reply within two business days.";

/** Emergency boundary — shown wherever the support inbox is offered. */
export const SUPPORT_NOT_MONITORED_COPY =
  "Mellowa does not monitor this inbox for emergencies.";
