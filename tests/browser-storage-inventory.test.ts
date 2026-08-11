import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BROWSER_STORAGE_REGISTRY,
  isRegisteredStorageKey,
} from "@/lib/privacy/browser-storage";

/**
 * MW-V17-03: sensitive daily check-in answers must never be persisted to
 * long-lived browser storage. This is the guardrail that keeps them out: every
 * `setItem` in the app must write a key the registry allows, and the check-in
 * form must persist nothing at all. A new unregistered key — or a sensitive
 * field reintroduced into storage — fails here.
 */

const SRC = join(__dirname, "..", "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** Resolve the key a `setItem` call writes: a literal, a const, or a template prefix. */
function resolveKey(argExpr: string, fileSrc: string): { key: string; prefix: boolean } | null {
  const arg = argExpr.trim();
  // String literal: "key" or 'key'
  const lit = arg.match(/^["']([^"']+)["']$/);
  if (lit) return { key: lit[1], prefix: false };
  // Inline template literal: `mellowa_now_deferred:${...}` → static prefix.
  const tmpl = arg.match(/^`([^$`]*)\$\{/);
  if (tmpl) return { key: tmpl[1], prefix: true };
  // Identifier: resolve `const IDENT = "..."` or a template const in the same file.
  const ident = arg.match(/^[A-Za-z_$][\w$]*$/);
  if (ident) {
    const constLit = fileSrc.match(new RegExp(`const\\s+${arg}\\s*=\\s*["']([^"']+)["']`));
    if (constLit) return { key: constLit[1], prefix: false };
    const constTmpl = fileSrc.match(new RegExp(`const\\s+${arg}\\s*=\\s*\`([^$\`]*)\\$\\{`));
    if (constTmpl) return { key: constTmpl[1], prefix: true };
  }
  return null; // could not statically resolve
}

describe("browser storage inventory", () => {
  const files = walk(SRC);

  it("every persisted key is registered in the storage allow-list", () => {
    const unregistered: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/(?:local|session)Storage\.setItem\(\s*([^,]+),/g)) {
        const resolved = resolveKey(m[1], src);
        if (!resolved) {
          unregistered.push(`${file}: unresolved setItem key expression "${m[1].trim()}"`);
          continue;
        }
        const ok = resolved.prefix
          ? BROWSER_STORAGE_REGISTRY.some((r) => r.pattern && r.key === resolved.key)
          : isRegisteredStorageKey(resolved.key);
        if (!ok) unregistered.push(`${file}: unregistered storage key "${resolved.key}"`);
      }
    }
    expect(unregistered, unregistered.join("\n")).toEqual([]);
  });

  it("the check-in form persists nothing to browser storage", () => {
    const checkin = readFileSync(
      join(SRC, "components", "dailyflow", "checkin-form.tsx"),
      "utf8",
    );
    expect(checkin).not.toMatch(/(?:local|session)Storage\.setItem/);
  });

  it("no registered key carries a sensitive sensitivity class", () => {
    // The registry may only hold opaque ids, navigation hints and bounded
    // deferrals. Anything else would be a sensitive field sneaking in.
    const allowed = new Set(["opaque_id", "navigation_hint", "bounded_deferral"]);
    for (const r of BROWSER_STORAGE_REGISTRY) {
      expect(allowed.has(r.sensitivity), `${r.key} has sensitivity ${r.sensitivity}`).toBe(true);
    }
  });
});
