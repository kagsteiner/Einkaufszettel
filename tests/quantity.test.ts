import assert from "node:assert/strict";
import { test } from "node:test";
import { addDecimal, normalizeQuantity } from "../src/server/quantity.ts";

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
});
