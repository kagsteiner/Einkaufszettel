import assert from "node:assert/strict";
import test from "node:test";
import { unicodeProductIcons } from "../src/client/product-icons.generated.ts";
import { productIcon } from "../src/client/product-icons.ts";

test("the generated Unicode table contains many German product-like symbol names", () => {
  assert.ok(Object.keys(unicodeProductIcons).length > 300);
  assert.equal(productIcon("Ei"), "🥚");
  assert.equal(productIcon("Tomate"), "🍅");
  assert.equal(productIcon("Toilettenpapier"), "🧻");
});

test("German shopping aliases and compounds resolve without an AI call", () => {
  assert.equal(productIcon("Eier"), "🥚");
  assert.equal(productIcon("6 Bio-Eier, Größe M"), "🥚");
  assert.equal(productIcon("Frische Tomaten"), "🍅");
  assert.equal(productIcon("Vollmilch"), "🥛");
  assert.equal(productIcon("Unbekanntes Spezialprodukt"), null);
});
