// Pure validation logic (no secrets) — shared by server routes and the
// onboarding UI, which flags unrecognized allergy terms live (Prompt 8).
import type { MealCardType } from "@/schemas/ai-output-v2";

/**
 * Deterministic allergen validation (Prompt 5).
 *
 * The AI prompt already says "never include listed allergens", but prompts are
 * not safety guarantees. After every meal generation we normalise the user's
 * allergy list to canonical categories (with synonyms and common derivative
 * ingredients) and scan every ingredient, swap suggestion, grocery item and
 * preparation step. Any possible match rejects the meal.
 *
 * Limitation (always shown to users): Mellowa cannot guarantee medical-allergy
 * safety — severe allergies require checking actual product labels.
 */

// Canonical categories → match terms (matched on word boundaries, lowercase).
// Terms include derivatives, e.g. dairy covers whey/casein/butter.
const ALLERGEN_MAP: Record<string, string[]> = {
  peanut: ["peanut", "peanuts", "peanut butter", "groundnut", "groundnuts", "satay"],
  tree_nut: [
    "almond", "almonds", "walnut", "walnuts", "cashew", "cashews", "pecan",
    "pecans", "pistachio", "pistachios", "hazelnut", "hazelnuts", "macadamia",
    "brazil nut", "brazil nuts", "pine nut", "pine nuts", "nut", "nuts",
    "nut butter", "praline", "marzipan", "nougat",
  ],
  dairy: [
    "milk", "cheese", "butter", "cream", "yogurt", "yoghurt", "whey", "casein",
    "ghee", "kefir", "mozzarella", "parmesan", "cheddar", "feta", "ricotta",
    "mascarpone", "buttermilk", "custard", "ice cream", "lactose", "halloumi",
    "cottage cheese", "creme fraiche", "crème fraîche",
  ],
  egg: ["egg", "eggs", "mayonnaise", "mayo", "aioli", "meringue", "albumin", "frittata", "omelette", "omelet"],
  gluten: [
    "wheat", "flour", "bread", "pasta", "noodles", "couscous", "bulgur",
    "semolina", "barley", "rye", "spelt", "seitan", "breadcrumbs", "cracker",
    "crackers", "tortilla", "wrap", "pita", "gluten", "soy sauce", "croutons",
    "orzo", "farro", "malt", "wheat berries", "panko",
  ],
  soy: ["soy", "soya", "tofu", "tempeh", "edamame", "soy sauce", "tamari", "miso", "soybean", "soybeans", "soy milk"],
  fish: [
    "fish", "salmon", "tuna", "cod", "haddock", "trout", "sardine", "sardines",
    "anchovy", "anchovies", "mackerel", "tilapia", "sea bass", "fish sauce",
    "worcestershire",
  ],
  shellfish: [
    "shrimp", "prawn", "prawns", "crab", "lobster", "mussel", "mussels",
    "clam", "clams", "oyster", "oysters", "scallop", "scallops", "squid",
    "calamari", "octopus", "shellfish",
  ],
  sesame: ["sesame", "tahini", "sesame oil", "sesame seeds"],
  celery: ["celery", "celeriac"],
  mustard: ["mustard", "dijon"],
};

// User-input synonyms → canonical category.
const USER_TERM_TO_CATEGORY: Record<string, string> = {
  peanut: "peanut", peanuts: "peanut", groundnut: "peanut",
  nut: "tree_nut", nuts: "tree_nut", "tree nut": "tree_nut", "tree nuts": "tree_nut",
  almond: "tree_nut", walnut: "tree_nut", cashew: "tree_nut", hazelnut: "tree_nut",
  dairy: "dairy", milk: "dairy", lactose: "dairy", whey: "dairy", casein: "dairy", cheese: "dairy",
  egg: "egg", eggs: "egg",
  gluten: "gluten", wheat: "gluten", celiac: "gluten", coeliac: "gluten",
  soy: "soy", soya: "soy", soybean: "soy",
  fish: "fish",
  shellfish: "shellfish", shrimp: "shellfish", prawn: "shellfish", prawns: "shellfish",
  crustacean: "shellfish", crustaceans: "shellfish", seafood: "shellfish",
  sesame: "sesame", tahini: "sesame",
  celery: "celery",
  mustard: "mustard",
};

export interface NormalizedAllergies {
  categories: string[];
  /** User entries that didn't map to a category — matched literally. */
  customTerms: string[];
}

export function normalizeAllergies(allergies: string[]): NormalizedAllergies {
  const categories = new Set<string>();
  const customTerms: string[] = [];
  for (const raw of allergies) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    // Try full entry, then each word (handles "cow's milk allergy").
    const direct = USER_TERM_TO_CATEGORY[entry];
    if (direct) {
      categories.add(direct);
      continue;
    }
    let matched = false;
    for (const [term, cat] of Object.entries(USER_TERM_TO_CATEGORY)) {
      if (new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(entry)) {
        categories.add(cat);
        matched = true;
      }
    }
    if (!matched) customTerms.push(entry);
  }
  return { categories: [...categories], customTerms };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termsForCategories(categories: string[]): { term: string; category: string }[] {
  const out: { term: string; category: string }[] = [];
  for (const cat of categories) {
    for (const term of ALLERGEN_MAP[cat] ?? []) out.push({ term, category: cat });
  }
  return out;
}

export interface AllergenViolation {
  category: string;
  /** Where it was found: ingredient | swap | grocery | step. */
  location: string;
}

/** Collects all searchable text fields of a meal card. */
function mealTexts(meal: MealCardType): { text: string; location: string }[] {
  return [
    ...meal.ingredients.map((i) => ({ text: i.name, location: "ingredient" })),
    ...meal.preparation_steps.map((s) => ({ text: s, location: "step" })),
    ...meal.grocery_items.map((g) => ({ text: g, location: "grocery" })),
    { text: meal.low_energy_swap ?? "", location: "swap" },
    { text: meal.vegetarian_swap ?? "", location: "swap" },
    { text: meal.dairy_free_swap ?? "", location: "swap" },
    { text: meal.gluten_free_swap ?? "", location: "swap" },
    { text: meal.leftovers_tip ?? "", location: "swap" },
    { text: meal.title, location: "title" },
    { text: meal.short_description ?? "", location: "title" },
  ].filter((t) => t.text);
}

/**
 * Deterministically checks one meal against the user's allergies.
 * Returns violations (category + location only — no sensitive free text).
 */
export function findMealAllergenViolations(
  meal: MealCardType,
  allergies: string[]
): AllergenViolation[] {
  if (!allergies.length) return [];
  const normalized = normalizeAllergies(allergies);
  const catTerms = termsForCategories(normalized.categories);
  const customTerms = normalized.customTerms.map((t) => ({
    term: t,
    category: `custom:${t}`,
  }));
  const allTerms = [...catTerms, ...customTerms];
  if (!allTerms.length) return [];

  const violations: AllergenViolation[] = [];
  const seen = new Set<string>();
  for (const { text, location } of mealTexts(meal)) {
    const lower = text.toLowerCase();
    for (const { term, category } of allTerms) {
      const key = `${category}:${location}`;
      if (seen.has(key)) continue;
      if (new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(lower)) {
        // Swap fields legitimately name the allergen they replace
        // ("dairy-free swap: use oat milk instead of milk") — only flag swaps
        // when the term is suggested as an addition is hard to detect, so we
        // still flag; the regeneration instruction tells the model to avoid
        // mentioning the allergen entirely.
        violations.push({ category, location });
        seen.add(key);
      }
    }
  }
  return violations;
}

/** Checks every meal card; returns per-meal violations keyed by meal title index. */
export function findPlanAllergenViolations(
  meals: MealCardType[],
  allergies: string[]
): { mealIndex: number; violations: AllergenViolation[] }[] {
  const out: { mealIndex: number; violations: AllergenViolation[] }[] = [];
  meals.forEach((meal, mealIndex) => {
    const violations = findMealAllergenViolations(meal, allergies);
    if (violations.length) out.push({ mealIndex, violations });
  });
  return out;
}

/** Builds the explicit-exclusion instruction for a regeneration attempt. */
export function allergenExclusionInstruction(allergies: string[]): string {
  const normalized = normalizeAllergies(allergies);
  const parts = [...normalized.categories, ...normalized.customTerms];
  return `CRITICAL ALLERGY SAFETY: the previous meal contained or mentioned a listed allergen. The user is allergic to: ${parts.join(
    ", "
  )}. Every meal, ingredient, swap suggestion, grocery item and preparation step must completely avoid these allergens and ALL their derivatives (e.g. dairy includes whey, casein, butter, cheese; gluten includes wheat flour, bread, pasta, soy sauce). Do not even mention them as things to avoid — simply build meals without them.`;
}

/**
 * Detects a severe / life-threatening allergy signal (Prompt 8). When true,
 * Mellowa must not generate specific meals — deterministic text matching
 * cannot guarantee product-label or cross-contamination safety.
 */
export function detectSevereAllergySignal(texts: (string | null | undefined)[]): boolean {
  const combined = texts.filter(Boolean).join(" ").toLowerCase();
  if (!combined) return false;
  return [
    /anaphyla/i,
    /epi[-\s]?pen/i,
    /life[-\s]threatening/i,
    /severe(ly)? allergic/i,
    /severe allerg/i,
    /deadly allerg/i,
    /airborne allerg/i,
    /hospitali[sz]ed .*allerg/i,
  ].some((re) => re.test(combined));
}

export const SEVERE_ALLERGY_MESSAGE =
  "Because you've told us about a severe or life-threatening allergy, Mellowa doesn't suggest specific meals or recipes — automated checks can't guarantee ingredient, label or cross-contamination safety at that level. A registered dietitian or allergy specialist can help you build a safe meal routine. Everything else in Mellowa is still here for you.";

export const ALLERGEN_DISCLAIMER =
  "Meals are checked against your listed allergies, but Mellowa cannot guarantee allergy safety — always verify product labels, especially for severe allergies.";

/**
 * Text-level allergen scan for non-meal-card outputs (weekly meal structures,
 * shopping items, meal rhythm ideas, low-energy easy meals). Returns matched
 * allergen categories only — never free text.
 */
export function findAllergenCategoriesInText(
  text: string,
  allergies: string[]
): string[] {
  if (!allergies.length || !text) return [];
  const normalized = normalizeAllergies(allergies);
  const allTerms = [
    ...termsForCategories(normalized.categories),
    ...normalized.customTerms.map((t) => ({ term: t, category: `custom:${t}` })),
  ];
  const lower = text.toLowerCase();
  const hits = new Set<string>();
  for (const { term, category } of allTerms) {
    if (new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(lower)) hits.add(category);
  }
  return [...hits];
}
