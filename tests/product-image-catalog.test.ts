import assert from "node:assert/strict";
import test from "node:test";
import {
  createProductImageCatalog,
  normalizeProductName,
  productImageFile,
  unknownProductImageFile,
} from "../src/client/product-image-catalog.ts";

test("product image mappings support aliases and normalized German product names", () => {
  const catalog = createProductImageCatalog({
    images: [
      {
        file: "images/products/kaese.jpg",
        products: ["Käse", "Bergkäse", "Schnittkäse"],
      },
    ],
    version: 1,
  });

  assert.equal(normalizeProductName("  BERGKÄSE  "), "bergkäse");
  assert.equal(productImageFile(catalog, "Bergkäse"), "images/products/kaese.jpg");
  assert.equal(productImageFile(catalog, "schnittkäse"), "images/products/kaese.jpg");
  assert.equal(productImageFile(catalog, "Frischkäse"), unknownProductImageFile);
});

test("invalid mappings are ignored and the first duplicate mapping wins", () => {
  const catalog = createProductImageCatalog({
    images: [
      { file: "../outside.jpg", products: ["Butter"] },
      { file: "images/products/butter.jpg", products: ["Butter"] },
      { file: "images/products/gouda.jpg", products: ["Butter"] },
      { file: "images/products/empty.jpg", products: "not-an-array" },
    ],
  });

  assert.equal(productImageFile(catalog, "Butter"), "images/products/butter.jpg");
});
