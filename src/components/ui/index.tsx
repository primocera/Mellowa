import clsx from "clsx";
import Link from "next/link";

/**
 * MW-V9-09: a small shared UI pattern layer built on the existing Tailwind
 * conventions (palette, rounded-2xl cards, 44px targets). One source of truth
 * for the recurring primitives — button, callout, skeleton, empty state — so
 * critical flows stay visually consistent and accessible. No new UI framework
 * and no brand change; these only codify patterns already used across v8.
 */

type ButtonVariant = "primary" | "secondary" | "quiet" | "destructive";

const BUTTON_BASE =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C9A92] focus-visible:ring-offset-2 disabled:opacity-60 disabled:pointer-events-none";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-[#7C9A92] text-white hover:bg-[#6D8C7D]",
  secondary:
    "border border-[#E5E1DA] bg-white text-[#1F2937] hover:border-[#7C9A92]/50",
  quiet: "text-[#6B7280] hover:text-[#1F2937]",
  destructive: "border border-[#FCA5A5] bg-white text-[#991B1B] hover:bg-[#FEE2E2]",
};

export function buttonClass(variant: ButtonVariant = "primary", className?: string) {
  return clsx(BUTTON_BASE, BUTTON_VARIANTS[variant], className);
}

export function Button({
  variant = "primary",
  className,
  ...props
}: { variant?: ButtonVariant } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={buttonClass(variant, className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: { variant?: ButtonVariant } & React.ComponentProps<typeof Link>) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}

type CalloutTone = "neutral" | "success" | "warning" | "error";

const CALLOUT_TONES: Record<CalloutTone, string> = {
  neutral: "bg-[#EEF2FF] text-[#1F2937]",
  success: "bg-[#DCFCE7] text-[#166534]",
  warning: "bg-[#FEF3C7] text-[#92400E]",
  error: "bg-[#FEE2E2] text-[#991B1B]",
};

/** Status/message block. Errors announce assertively; others politely. */
export function Callout({
  tone = "neutral",
  className,
  children,
}: {
  tone?: CalloutTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={clsx("rounded-xl px-4 py-3 text-sm", CALLOUT_TONES[tone], className)}
    >
      {children}
    </div>
  );
}

/** Reduced-motion-safe loading placeholder (pulse is disabled by the user's
 *  OS setting via Tailwind's motion-reduce variant). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={clsx(
        "animate-pulse rounded-xl bg-[#ECE8E1] motion-reduce:animate-none",
        className
      )}
    />
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
      <h2 className="text-lg font-semibold text-[#1F2937]">{title}</h2>
      {description && <p className="mt-2 text-sm text-[#6B7280]">{description}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}
