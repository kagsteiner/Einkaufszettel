import assert from "node:assert/strict";
import test from "node:test";
import { unicodeProductIcons } from "../src/client/product-icons.generated.ts";
import { productIcon } from "../src/client/product-icons.ts";
import { inferProductCategory } from "../src/shared/product-categories.ts";

test("the generated Unicode table contains many German product-like symbol names", () => {
  assert.ok(Object.keys(unicodeProductIcons).length > 300);
  assert.equal(productIcon("Ei"), "🥚");
  assert.equal(productIcon("Tomate"), "🍅");
  assert.equal(productIcon("Toilettenpapier"), "🧻");
});

test("common direct entries get a local category fallback", () => {
  assert.equal(inferProductCategory("Schlagsahne"), "dairy");
  assert.equal(inferProductCategory("Frischer Lachs"), "meat");
  assert.equal(inferProductCategory("Spülmittel sensitiv"), "household");
  assert.equal(inferProductCategory("Weintrauben"), "produce");
  assert.equal(inferProductCategory("Unbekanntes Spezialprodukt"), undefined);
});

test("German shopping aliases and compounds resolve without an AI call", () => {
  assert.equal(productIcon("Eier"), "🥚");
  assert.equal(productIcon("6 Bio-Eier, Größe M"), "🥚");
  assert.equal(productIcon("Frische Tomaten"), "🍅");
  assert.equal(productIcon("Vollmilch"), "🥛");
  assert.equal(productIcon("Unbekanntes Spezialprodukt"), null);
});
