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
    images: [{ file: "images/products/kaese.jpg", id: "kaese" }],
    products: [
      {
        id: "kaese",
        image: "kaese",
        names: ["Käse", "Bergkäse", "Schnittkäse"],
      },
    ],
    version: 2,
  });

  assert.equal(normalizeProductName("  BERGKÄSE  "), "bergkäse");
  assert.equal(productImageFile(catalog, "Bergkäse"), "images/products/kaese.jpg");
  assert.equal(productImageFile(catalog, "schnittkäse"), "images/products/kaese.jpg");
  assert.equal(productImageFile(catalog, "Frischkäse"), unknownProductImageFile);
});

test("visual fallbacks do not imply a natural product hierarchy", () => {
  const catalog = createProductImageCatalog({
    images: [
      { file: "images/products/mozzarella.jpg", id: "mozzarella" },
      { file: "images/products/reibekaese.jpg", id: "reibekaese" },
    ],
    products: [
      {
        id: "mozzarella",
        image: "mozzarella",
        names: ["Mozzarella"],
      },
      {
        id: "reibekaese",
        image: "reibekaese",
        names: ["Reibekäse"],
      },
      {
        id: "mozzarella-gerieben",
        imageFallback: "reibekaese",
        names: ["Mozzarella gerieben"],
      },
    ],
    version: 2,
  });

  assert.equal(productImageFile(catalog, "Mozzarella"), "images/products/mozzarella.jpg");
  assert.equal(productImageFile(catalog, "Mozzarella gerieben"), "images/products/reibekaese.jpg");
});

test("visual fallbacks traverse multiple levels and stop at cycles", () => {
  const baseDocument = {
    images: [{ file: "images/products/fleisch.jpg", id: "fleisch" }],
    products: [
      { id: "fleisch", image: "fleisch", names: ["Fleisch"] },
      { id: "schinken", imageFallback: "fleisch", names: ["Schinken"] },
      {
        id: "wacholderschinken",
        imageFallback: "schinken",
        names: ["Wacholderschinken"],
      },
      { id: "cycle-a", imageFallback: "cycle-b", names: ["Kreis A"] },
      { id: "cycle-b", imageFallback: "cycle-a", names: ["Kreis B"] },
    ],
    version: 2,
  };
  const catalog = createProductImageCatalog(baseDocument);

  assert.equal(productImageFile(catalog, "Wacholderschinken"), "images/products/fleisch.jpg");
  assert.equal(productImageFile(catalog, "Kreis A"), unknownProductImageFile);
});

test("legacy image-centric mappings remain readable during deployment", () => {
  const catalog = createProductImageCatalog({
    images: [
      {
        file: "images/products/butter.jpg",
        id: "butter",
        products: ["Butter", "Margarine"],
      },
    ],
    version: 1,
  });

  assert.equal(productImageFile(catalog, "Margarine"), "images/products/butter.jpg");
});

test("invalid mappings are ignored and the first duplicate name wins", () => {
  const catalog = createProductImageCatalog({
    images: [
      { file: "../outside.jpg", id: "outside" },
      { file: "images/products/butter.jpg", id: "butter" },
      { file: "images/products/gouda.jpg", id: "gouda" },
    ],
    products: [
      { id: "invalid", image: "outside", names: ["Ungültig"] },
      { id: "butter", image: "butter", names: ["Butter"] },
      { id: "gouda", image: "gouda", names: ["Butter"] },
      { id: "empty", image: "gouda", names: "not-an-array" },
    ],
    version: 2,
  });

  assert.equal(productImageFile(catalog, "Butter"), "images/products/butter.jpg");
  assert.equal(productImageFile(catalog, "Ungültig"), unknownProductImageFile);
});
