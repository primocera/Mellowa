import { describe, it, expect } from "vitest";
import {
  parseGroceryItem,
  categorize,
  aggregateShopping,
  formatItem,
} from "@/lib/shopping/aggregate";

describe("shopping aggregation (Prompt 13)", () => {
  it("parses quantity, unit and name", () => {
    expect(parseGroceryItem("200 g spinach")).toEqual({
      quantity: 200,
      unit: "g",
      name: "spinach",
    });
    expect(parseGroceryItem("2 eggs")).toEqual({
      quantity: 2,
      unit: null,
      name: "eggs",
    });
    expect(parseGroceryItem("olive oil")).toEqual({
      quantity: null,
      unit: null,
      name: "olive oil",
    });
  });

  it("merges only when the unit matches exactly", () => {
    const groups = aggregateShopping([
      { title: "A", grocery_items: ["200 g rice"] },
      { title: "B", grocery_items: ["100 g rice"] },
    ]);
    const rice = groups.flatMap((g) => g.items).find((i) => i.name === "rice")!;
    expect(rice.quantity).toBe(300);
    expect(rice.unit).toBe("g");
    expect(rice.sources.sort()).toEqual(["A", "B"]);
  });

  it("does NOT merge across incompatible units", () => {
    const groups = aggregateShopping([
      { title: "A", grocery_items: ["1 kg rice"] },
      { title: "B", grocery_items: ["200 g rice"] },
    ]);
    const riceItems = groups.flatMap((g) => g.items).filter((i) => i.name === "rice");
    expect(riceItems).toHaveLength(2); // kg and g stay separate lines
  });

  it("scales quantities by servings", () => {
    const groups = aggregateShopping(
      [{ title: "A", grocery_items: ["100 g oats"] }],
      2
    );
    const oats = groups.flatMap((g) => g.items).find((i) => i.name === "oats")!;
    expect(oats.quantity).toBe(200);
  });

  it("groups items into store categories in order", () => {
    const groups = aggregateShopping([
      {
        title: "A",
        grocery_items: ["2 chicken breast", "200 g spinach", "1 bread"],
      },
    ]);
    expect(groups.map((g) => g.category)).toEqual([
      "Produce",
      "Meat & fish",
      "Bakery",
    ]);
  });

  it("categorizes unknown items as Other", () => {
    expect(categorize("dragonfruit powder")).toBe("Other");
    expect(categorize("chicken thigh")).toBe("Meat & fish");
  });

  it("keeps un-parseable duplicates as notes rather than losing them", () => {
    const groups = aggregateShopping([
      { title: "A", grocery_items: ["a pinch of salt"] },
      { title: "B", grocery_items: ["a pinch of salt"] },
    ]);
    const salt = groups.flatMap((g) => g.items).find((i) => i.name.includes("salt"))!;
    expect(salt.notes.length).toBe(2);
  });

  it("formats a merged item cleanly", () => {
    expect(
      formatItem({
        name: "rice",
        unit: "g",
        quantity: 300,
        notes: [],
        sources: ["A"],
        category: "Pantry",
      })
    ).toBe("300 g rice");
  });
});
