import "server-only";
import type { z } from "zod";

/**
 * LOCAL DEV ONLY — set AI_MOCK=1 in .env.local to skip the real AI provider.
 * Builds placeholder data straight from the Zod output schema, so every
 * generation route works offline and costs nothing. Never enable in prod.
 */
export function isAiMockEnabled(): boolean {
  return process.env.AI_MOCK === "1";
}

type ZodDef = {
  type: string;
  shape?: Record<string, z.ZodTypeAny>;
  element?: z.ZodTypeAny;
  innerType?: z.ZodTypeAny;
  entries?: Record<string, string>;
  values?: unknown[];
  options?: z.ZodTypeAny[];
};

function defOf(schema: z.ZodTypeAny): ZodDef {
  return (schema as unknown as { _zod: { def: ZodDef } })._zod.def;
}

function mockValue(schema: z.ZodTypeAny, path: string[]): unknown {
  const def = defOf(schema);
  const label = path[path.length - 1] ?? "value";

  switch (def.type) {
    case "string":
      return `Mock ${label.replace(/_/g, " ")} (local test)`;
    case "number":
    case "int":
      return 3;
    case "boolean":
      return false;
    case "enum": {
      const values = Object.values(def.entries ?? {});
      return values[0] ?? "";
    }
    case "literal":
      return def.values?.[0];
    case "array": {
      const el = def.element as z.ZodTypeAny;
      return [0, 1, 2].map((i) => mockValue(el, [...path, `${label} ${i + 1}`]));
    }
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(def.shape ?? {})) {
        out[key] = mockValue(child, [...path, key]);
      }
      return out;
    }
    case "default":
    case "optional":
    case "nullable":
    case "prefault":
    case "catch":
      return mockValue(def.innerType as z.ZodTypeAny, path);
    case "union":
      return mockValue((def.options as z.ZodTypeAny[])[0], path);
    case "record":
      return {};
    case "null":
      return null;
    default:
      return `Mock ${label}`;
  }
}

export function mockFromSchema<S extends z.ZodTypeAny>(schema: S): z.infer<S> {
  const candidate = mockValue(schema, []);
  const parsed = schema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(
      `AI mock could not satisfy schema: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.code}`)
        .join("; ")}`
    );
  }
  return parsed.data;
}
