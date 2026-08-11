/**
 * Central browser-storage registry (MW-V17-03).
 *
 * Sensitive daily check-in answers — mood, stress, sleep, hunger, energy, focus,
 * context and free-text notes — must never sit in long-lived, same-origin
 * readable storage. They used to be autosaved wholesale under
 * `mellowa_checkin_draft`. This module is the single allow-list of what MAY be
 * persisted in the browser, plus the purge helpers. A contract test
 * (`tests/browser-storage-inventory.test.ts`) fails if any `setItem` writes a key
 * that is not registered here, so a sensitive field cannot be reintroduced later.
 *
 * The rule: only opaque preference ids, a non-sensitive navigation hint and
 * bounded per-plan deferrals are allowed. No wellbeing value, journal text,
 * allergy, or plan content is ever persisted.
 */

export type StorageSensitivity =
  /** A random opaque id with no personal meaning (e.g. anonymous analytics id). */
  | "opaque_id"
  /** A small non-sensitive navigation hint (e.g. a wizard step index). */
  | "navigation_hint"
  /** Bounded, device-only, non-sensitive interaction state (e.g. deferrals). */
  | "bounded_deferral";

export interface RegisteredStorageKey {
  /** Exact key, or a prefix when `pattern` is true (e.g. "mellowa_now_deferred:"). */
  key: string;
  /** When true, `key` is a prefix and any `${key}<suffix>` is allowed. */
  pattern?: boolean;
  store: "localStorage" | "sessionStorage";
  sensitivity: StorageSensitivity;
  /** Cleared by `purgeSensitiveBrowserStorage()` (sign-out / account deletion). */
  purgeOnSignOut: boolean;
  /** What it holds and why it is safe. */
  note: string;
}

export const BROWSER_STORAGE_REGISTRY: readonly RegisteredStorageKey[] = [
  {
    key: "mellowa_anon_id",
    store: "localStorage",
    sensitivity: "opaque_id",
    purgeOnSignOut: false,
    note: "Opaque pre-signup analytics id. No personal meaning; kept across sessions.",
  },
  {
    key: "mellowa.onboarding.progress.v2",
    store: "localStorage",
    sensitivity: "navigation_hint",
    purgeOnSignOut: true,
    note: "Onboarding step index only ({step}); never any answer value.",
  },
  {
    key: "mellowa_now_deferred:",
    pattern: true,
    store: "localStorage",
    sensitivity: "bounded_deferral",
    purgeOnSignOut: true,
    note: "Per-plan 'Not now' item keys; bounded, device-only, non-sensitive.",
  },
];

/**
 * Legacy keys that must be purged WITHOUT being read, parsed, logged or migrated
 * — they may contain sensitive wellbeing answers written before this change.
 */
export const LEGACY_SENSITIVE_KEYS: readonly string[] = [
  "mellowa_checkin_draft",
  "mellowa.onboarding.draft.v1",
];

/** True when a persisted key is allowed by the registry (exact or prefix). */
export function isRegisteredStorageKey(key: string): boolean {
  return BROWSER_STORAGE_REGISTRY.some((r) =>
    r.pattern ? key.startsWith(r.key) : key === r.key,
  );
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null; // private mode / disabled storage
  }
}

/**
 * Remove the legacy sensitive check-in draft without reading its value. Idempotent
 * and safe when storage is unavailable. Called on check-in mount so an old draft
 * cannot linger on the device.
 */
export function purgeCheckinDraft(): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    ls.removeItem("mellowa_checkin_draft");
  } catch {
    /* storage unavailable — nothing to purge */
  }
}

/**
 * Purge sensitive/purge-on-sign-out browser storage on sign-out and verified
 * account deletion. Removes the legacy sensitive keys and every registered key
 * marked `purgeOnSignOut`, including pattern keys. Never reads a value; never
 * sends anything to telemetry. Idempotent and storage-safe.
 */
export function purgeSensitiveBrowserStorage(): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  const remove = (k: string) => {
    try {
      ls.removeItem(k);
    } catch {
      /* ignore */
    }
  };

  for (const k of LEGACY_SENSITIVE_KEYS) remove(k);

  for (const r of BROWSER_STORAGE_REGISTRY) {
    if (!r.purgeOnSignOut) continue;
    if (!r.pattern) {
      remove(r.key);
      continue;
    }
    // Pattern keys: collect matching keys first, then remove (mutating during
    // iteration over `key(i)` would skip entries).
    const matches: string[] = [];
    try {
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k && k.startsWith(r.key)) matches.push(k);
      }
    } catch {
      /* ignore */
    }
    for (const k of matches) remove(k);
  }
}
