// Prompt 13: pure shopping-list aggregation. Parses free-text grocery lines
// into quantity/unit/name, merges only when the unit is exactly compatible,
// groups into store categories, and keeps which meals each item came from.
// No calorie or nutrition totals are ever produced here.

export type ParsedItem = {
  quantity: number | null;
  unit: string | null;
  name: string;
};

export type ShoppingItem = {
  name: string;
  unit: string | null;
  quantity: number | null;
  /** Raw lines that could not be merged numerically, shown verbatim. */
  notes: string[];
  /** Titles of the meals this item came from (traceability). */
  sources: string[];
  category: string;
};

export type ShoppingCategory = { category: string; items: ShoppingItem[] };

// Units we treat as the same measure. We deliberately do NOT convert between
// units (e.g. g↔kg) — merging only happens for an exact unit match, so we
// never silently mis-scale a quantity.
const UNIT_ALIASES: Record<string, string> = {
  g: "g",
  gram: "g",
  grams: "g",
  kg: "kg",
  ml: "ml",
  l: "l",
  litre: "l",
  liter: "l",
  tbsp: "tbsp",
  tablespoon: "tbsp",
  tsp: "tsp",
  teaspoon: "tsp",
  cup: "cup",
  cups: "cup",
  clove: "clove",
  cloves: "clove",
  slice: "slice",
  slices: "slice",
  can: "can",
  cans: "can",
};

const CATEGORY_KEYWORDS: { category: string; terms: string[] }[] = [
  { category: "Produce", terms: ["apple", "banana", "spinach", "lettuce", "tomato", "onion", "garlic", "carrot", "pepper", "cucumber", "berry", "berries", "lemon", "lime", "avocado", "potato", "broccoli", "mushroom", "herb", "cilantro", "parsley", "ginger", "kale", "courgette", "zucchini"] },
  { category: "Meat & fish", terms: ["chicken", "beef", "pork", "turkey", "salmon", "tuna", "fish", "shrimp", "prawn", "bacon", "sausage", "mince"] },
  { category: "Dairy & eggs", terms: ["milk", "cheese", "yogurt", "yoghurt", "butter", "egg", "cream", "feta"] },
  { category: "Bakery", terms: ["bread", "roll", "bagel", "tortilla", "wrap", "pita", "bun"] },
  { category: "Pantry", terms: ["rice", "pasta", "flour", "sugar", "oil", "vinegar", "bean", "lentil", "chickpea", "oat", "cereal", "sauce", "stock", "spice", "salt", "pepper", "honey", "nut", "seed", "can", "tin"] },
  { category: "Frozen", terms: ["frozen", "ice"] },
];

/** Parse a free-text grocery line into quantity / unit / name. */
export function parseGroceryItem(raw: string): ParsedItem {
  const text = raw.trim().replace(/\s+/g, " ");
  // Leading quantity, optional unit, then the name.
  const m = /^(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)?\s+(.*)$/.exec(text);
  if (!m) return { quantity: null, unit: null, name: text.toLowerCase() };
  const quantity = Number(m[1].replace(",", "."));
  const rawUnit = (m[2] ?? "").toLowerCase();
  const unit = rawUnit && UNIT_ALIASES[rawUnit] ? UNIT_ALIASES[rawUnit] : null;
  // If the token after the number wasn't a known unit, it's part of the name.
  const name = (unit ? m[3] : `${m[2] ?? ""} ${m[3]}`).trim().toLowerCase();
  return { quantity: Number.isFinite(quantity) ? quantity : null, unit, name };
}

/** Assign a store category from the item name; defaults to "Other". */
export function categorize(name: string): string {
  const n = name.toLowerCase();
  for (const { category, terms } of CATEGORY_KEYWORDS) {
    if (terms.some((t) => n.includes(t))) return category;
  }
  return "Other";
}

/**
 * Aggregate grocery lines from several meals into merged, categorised items.
 * @param meals list of {title, grocery_items}
 * @param servingsScale multiplier applied to every parsed quantity (default 1)
 */
export function aggregateShopping(
  meals: { title: string; grocery_items: string[] }[],
  servingsScale = 1
): ShoppingCategory[] {
  // Key by name+unit so only exact-unit matches merge.
  const byKey = new Map<string, ShoppingItem>();

  for (const meal of meals) {
    for (const raw of meal.grocery_items) {
      const parsed = parseGroceryItem(raw);
      if (!parsed.name) continue;
      const key = `${parsed.name}|${parsed.unit ?? ""}`;
      const existing = byKey.get(key);
      const scaledQty =
        parsed.quantity !== null ? parsed.quantity * servingsScale : null;

      if (!existing) {
        byKey.set(key, {
          name: parsed.name,
          unit: parsed.unit,
          quantity: scaledQty,
          notes: parsed.quantity === null ? [raw.trim()] : [],
          sources: [meal.title],
          category: categorize(parsed.name),
        });
        continue;
      }
      // Merge quantities only when both sides have a number (same unit by key).
      if (scaledQty !== null && existing.quantity !== null) {
        existing.quantity += scaledQty;
      } else if (scaledQty !== null && existing.quantity === null) {
        existing.quantity = scaledQty;
      } else if (parsed.quantity === null) {
        existing.notes.push(raw.trim());
      }
      if (!existing.sources.includes(meal.title)) existing.sources.push(meal.title);
    }
  }

  const groups = new Map<string, ShoppingItem[]>();
  for (const item of byKey.values()) {
    const list = groups.get(item.category) ?? [];
    list.push(item);
    groups.set(item.category, list);
  }
  // Stable category order matching a typical store flow.
  const ORDER = ["Produce", "Meat & fish", "Dairy & eggs", "Bakery", "Pantry", "Frozen", "Other"];
  return ORDER.filter((c) => groups.has(c)).map((category) => ({
    category,
    items: (groups.get(category) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

/** Human-readable single-line label for a merged item. */
export function formatItem(item: ShoppingItem): string {
  const qty =
    item.quantity !== null
      ? `${Number.isInteger(item.quantity) ? item.quantity : item.quantity.toFixed(1)}${item.unit ? ` ${item.unit}` : ""} `
      : "";
  return `${qty}${item.name}`.trim();
}
