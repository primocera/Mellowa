// Prompt 11: progressive disclosure rules for the Today plan, kept pure so
// they can be unit-tested without rendering the page.

export type CalmReset = "breathing" | "meditation" | "relaxation" | null;

/** Lighter days should feel calmer, not busier — no productivity push. */
export function isLighterDay(mode: string | null | undefined): boolean {
  return (
    mode === "low_energy" ||
    mode === "high_stress" ||
    mode === "reset" ||
    mode === "minimum"
  );
}

/**
 * Choose the single calm reset to surface. We never show all three at once;
 * breathing is the gentlest default, then reflection, then relaxation.
 */
export function pickCalmReset(available: {
  breathing?: unknown;
  meditation?: unknown;
  relaxation?: unknown;
}): CalmReset {
  if (available.breathing) return "breathing";
  if (available.meditation) return "meditation";
  if (available.relaxation) return "relaxation";
  return null;
}
