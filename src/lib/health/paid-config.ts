import contract from "../../../config/paid-required-env.json";
import type { ComponentStatus } from "@/lib/health";

/**
 * MW-04: the paid-launch config contract, shared with scripts/release-check.mjs
 * via config/paid-required-env.json. `paidReadinessConfig` is the subset of the
 * required environment that deep readiness can observe at runtime (secrets,
 * Stripe prices, legal identity). Every entry here is PAID-CRITICAL: in paid
 * mode a missing one fails readiness closed. A parity test asserts this list is
 * a subset of what release-check requires, so the two can never disagree.
 */
export const PAID_READINESS_CONFIG: readonly string[] = contract.paidReadinessConfig;
export const REQUIRED_ENV: readonly string[] = contract.requiredEnv;
export const PAID_LAUNCH_ENV: readonly string[] = contract.paidLaunchEnv;

/** Stable readiness component key for a config env var. */
export function configComponentKey(envVar: string): string {
  return `config_${envVar.toLowerCase()}`;
}

/**
 * Compute an { componentKey: status } map for every paid-required config var:
 * present → "ok", absent → "not_configured". In paid mode the readiness
 * summary treats a "not_configured" CRITICAL config as a failure; in beta it is
 * warn-only.
 */
export function paidConfigComponents(
  env: Record<string, string | undefined> = process.env
): Record<string, ComponentStatus> {
  const out: Record<string, ComponentStatus> = {};
  for (const name of PAID_READINESS_CONFIG) {
    out[configComponentKey(name)] = env[name] ? "ok" : "not_configured";
  }
  return out;
}

/** The readiness component keys that correspond to paid-critical config. */
export function paidConfigComponentKeys(): string[] {
  return PAID_READINESS_CONFIG.map(configComponentKey);
}
