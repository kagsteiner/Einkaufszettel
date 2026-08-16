import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import test from "node:test";
import sharp from "sharp";

interface ProductImageEntry {
  id: unknown;
  file: unknown;
}

interface ProductEntry {
  id: unknown;
  names: unknown;
  image?: unknown;
  imageFallback?: unknown;
}

interface ProductImageManifest {
  version: unknown;
  images: unknown;
  products: unknown;
}

const projectRoot = resolve(import.meta.dirname, "..");
const publicDirectory = resolve(projectRoot, "public");
const manifestPath = resolve(publicDirectory, "images/product-images.json");
const catalogIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

test("product image manifest contains a complete visual fallback graph", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ProductImageManifest;
  assert.equal(manifest.version, 2);
  assert.ok(Array.isArray(manifest.images));
  assert.ok(manifest.images.length > 0);
  assert.ok(Array.isArray(manifest.products));
  assert.ok(manifest.products.length > 0);

  const imageIds = new Set<string>();
  const files = new Set<string>();
  for (const candidate of manifest.images) {
    const image = candidate as ProductImageEntry;
    if (typeof image.id !== "string") {
      assert.fail("product image id must be a string");
    }
    const id = image.id;
    assert.match(id, catalogIdPattern);
    assert.ok(!imageIds.has(id), `duplicate image id: ${id}`);
    imageIds.add(id);

    if (typeof image.file !== "string") {
      assert.fail(`product image file must be a string: ${id}`);
    }
    const file = image.file;
    assert.match(file, /^images\/products\/[a-z0-9-]+\.jpg$/);
    assert.ok(!files.has(file), `duplicate image file: ${file}`);
    files.add(file);

    const imagePath = resolve(publicDirectory, file);
    assert.ok(
      imagePath.startsWith(`${resolve(publicDirectory, "images/products")}${sep}`),
      `image path escapes product directory: ${file}`,
    );
    const metadata = await sharp(imagePath).metadata();
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.width, 768);
    assert.equal(metadata.height, 768);
  }

  const products = new Map<string, ProductEntry>();
  const normalizedNames = new Map<string, string>();
  for (const candidate of manifest.products) {
    const product = candidate as ProductEntry;
    if (typeof product.id !== "string") {
      assert.fail("visual product id must be a string");
    }
    const id = product.id;
    assert.match(id, catalogIdPattern);
    assert.ok(!products.has(id), `duplicate visual product id: ${id}`);
    products.set(id, product);

    if (!Array.isArray(product.names)) {
      assert.fail(`product names must be an array: ${id}`);
    }
    assert.ok(product.names.length > 0, `missing product names: ${id}`);
    for (const name of product.names) {
      if (typeof name !== "string") {
        assert.fail(`product name must be a string: ${id}`);
      }
      assert.ok(name.trim(), `empty product name: ${id}`);
      assert.equal(name, name.normalize("NFC"), `product name must use NFC: ${name}`);
      const normalized = normalizeProductName(name);
      assert.ok(
        !normalizedNames.has(normalized),
        `duplicate product name "${name}": ${normalizedNames.get(normalized)} and ${id}`,
      );
      normalizedNames.set(normalized, id);
    }

    if (product.image !== undefined) {
      assert.equal(typeof product.image, "string", `invalid image reference: ${id}`);
      assert.match(product.image as string, catalogIdPattern);
    }
    if (product.imageFallback !== undefined) {
      assert.equal(
        typeof product.imageFallback,
        "string",
        `invalid image fallback reference: ${id}`,
      );
      assert.match(product.imageFallback as string, catalogIdPattern);
    }
    assert.ok(product.image || product.imageFallback, `missing visual resolution: ${id}`);
  }

  for (const [id, product] of products) {
    if (typeof product.image === "string") {
      assert.ok(imageIds.has(product.image), `missing image "${product.image}" for ${id}`);
    }
    if (typeof product.imageFallback === "string") {
      assert.ok(
        products.has(product.imageFallback),
        `missing image fallback "${product.imageFallback}" for ${id}`,
      );
    }

    const fallbackPath = new Set<string>();
    let fallbackId: string | undefined = id;
    while (fallbackId) {
      assert.ok(!fallbackPath.has(fallbackId), `cyclic image fallback at ${fallbackId}`);
      fallbackPath.add(fallbackId);
      const current = products.get(fallbackId);
      assert.ok(current, `missing visual product node: ${fallbackId}`);
      fallbackId = typeof current.imageFallback === "string" ? current.imageFallback : undefined;
    }

    const visited = new Set<string>();
    let currentId: string | undefined = id;
    let resolved = false;
    while (currentId) {
      assert.ok(!visited.has(currentId), `cyclic image fallback at ${currentId}`);
      visited.add(currentId);
      const current = products.get(currentId);
      assert.ok(current, `missing visual product node: ${currentId}`);
      if (typeof current.image === "string") {
        resolved = true;
        break;
      }
      currentId = typeof current.imageFallback === "string" ? current.imageFallback : undefined;
    }
    assert.ok(resolved, `image fallback does not resolve: ${id}`);
  }
});

test("household-product aliases resolve to their chosen visual product", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ProductImageManifest;
  assert.ok(Array.isArray(manifest.products));

  const visualProductByName = new Map<string, string>();
  for (const candidate of manifest.products) {
    const product = candidate as ProductEntry;
    if (typeof product.id !== "string" || !Array.isArray(product.names)) {
      continue;
    }
    for (const name of product.names) {
      if (typeof name === "string") {
        visualProductByName.set(normalizeProductName(name), product.id);
      }
    }
  }

  const expectedAliases = {
    allzweckreiniger: "desinfektion",
    badreiniger: "desinfektion",
    calcium: "calcium",
    citronensäure: "aroma",
    elektrolyte: "elektrolyte",
    entkalker: "shampoo",
    flüssigseife: "fluessigseife",
    frischhaltefolie: "tiefkuehlbeutel",
    handspülmittel: "duschgel",
    jodsalz: "jodsalz",
    knoblauchbutterbaguette: "kraeuterbutterbaguette",
    laktase: "doeschen",
    magnesium: "magnesium",
    putenschnitzel: "putensteak",
    scheuermilch: "shampoo",
    salz: "salz",
    spülbalsam: "duschgel",
    spülmaschinensalz: "karton",
    toilettenreiniger: "kloente",
    wasserenthärter: "karton",
    "wc-ente": "kloente",
    "wc-reiniger": "kloente",
    weichspüler: "waschmittel",
    zitronensäure: "aroma",
  };
  for (const [name, productId] of Object.entries(expectedAliases)) {
    assert.equal(visualProductByName.get(name), productId, `wrong visual product for ${name}`);
  }
});

function normalizeProductName(value: string): string {
  return value.trim().normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
}
