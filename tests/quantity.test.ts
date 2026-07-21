import assert from "node:assert/strict";
import { test } from "node:test";
import { addDecimal, normalizeQuantity } from "../src/server/quantity.ts";
import { findUnitDefinition, formatUnit } from "../src/shared/units.ts";

test("decimal addition does not introduce floating-point errors", () => {
  assert.equal(addDecimal("0.1", "0.2"), "0.3");
  assert.equal(addDecimal("2", "3.2500"), "5.25");
});

test("unit aliases normalize without converting physical units", () => {
  assert.deepEqual(normalizeQuantity({ amount: "2", unit: "Gramm" }), {
    amount: "2",
    normalizedUnit: "g",
    unit: "g",
  });
  assert.notEqual(
    normalizeQuantity({ amount: "1", unit: "kg" }).normalizedUnit,
    normalizeQuantity({ amount: "1000", unit: "g" }).normalizedUnit,
  );
  assert.equal(
    normalizeQuantity({ amount: "2", unit: "Flaschen" }).normalizedUnit,
    normalizeQuantity({ amount: "1", unit: "Flasche" }).normalizedUnit,
  );
});

test("editorial singular and plural spellings share one canonical unit", () => {
  const examples = [
    ["Dose", "dose"],
    ["Dosen", "dose"],
    ["Dose(n)", "dose"],
    ["Prise(n)", "prise"],
    ["Tasse/n", "tasse"],
    ["Zehe/n", "zehe"],
    ["Zehe(n)", "zehe"],
    ["Knoblauchzehe(n)", "zehe"],
    ["Zweig(e)", "zweig"],
  ] as const;

  for (const [unit, expected] of examples) {
    assert.equal(normalizeQuantity({ amount: "2", unit }).normalizedUnit, expected, unit);
  }
});

test("the unit registry covers the units found in the recipe examples", () => {
  const units = [
    "g",
    "ml",
    "Liter",
    "EL",
    "TL",
    "tbsp",
    "tsp",
    "Tasse",
    "Bund",
    "Prisen",
    "Dose",
    "Glas",
    "Pck.",
    "Msp",
    "Stange",
    "handful",
  ];

  for (const unit of units) {
    assert.ok(findUnitDefinition(unit), unit);
  }
});

test("display grammar comes from the unit registry", () => {
  assert.equal(formatUnit("Dose", "1"), "Dose");
  assert.equal(formatUnit("Dose", "2"), "Dosen");
  assert.equal(formatUnit("Zweig", "2"), "Zweige");
  assert.equal(formatUnit("Glas", "2"), "Gläser");
  assert.equal(formatUnit("Bund", "2"), "Bund");
  assert.equal(formatUnit("EL", "2"), "EL");
});

test("editorial suffixes are only removed for registered units", () => {
  assert.deepEqual(normalizeQuantity({ amount: "2", unit: "Tomate(n)" }), {
    amount: "2",
    normalizedUnit: "tomate(n)",
    unit: "Tomate(n)",
  });
});
