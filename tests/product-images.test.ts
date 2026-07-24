import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import test from "node:test";
import sharp from "sharp";

interface ProductImageEntry {
  id: unknown;
  file: unknown;
  products: unknown;
}

interface ProductImageManifest {
  version: unknown;
  images: unknown;
}

const projectRoot = resolve(import.meta.dirname, "..");
const publicDirectory = resolve(projectRoot, "public");
const manifestPath = resolve(publicDirectory, "images/product-images.json");

test("product image manifest points to unique 768 pixel JPEG assets", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ProductImageManifest;
  assert.equal(manifest.version, 1);
  assert.ok(Array.isArray(manifest.images));
  assert.ok(manifest.images.length > 0);

  const ids = new Set<string>();
  const files = new Set<string>();
  for (const candidate of manifest.images) {
    const image = candidate as ProductImageEntry;
    if (typeof image.id !== "string") {
      assert.fail("product image id must be a string");
    }
    const id = image.id;
    assert.match(id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(!ids.has(id), `duplicate image id: ${id}`);
    ids.add(id);

    if (typeof image.file !== "string") {
      assert.fail(`product image file must be a string: ${id}`);
    }
    const file = image.file;
    assert.match(file, /^images\/products\/[a-z0-9-]+\.jpg$/);
    assert.ok(!files.has(file), `duplicate image file: ${file}`);
    files.add(file);

    if (!Array.isArray(image.products)) {
      assert.fail(`product mappings must be an array: ${id}`);
    }
    assert.ok(image.products.length > 0, `missing product mapping: ${id}`);
    for (const product of image.products) {
      if (typeof product !== "string") {
        assert.fail(`product mapping must be a string: ${id}`);
      }
      assert.ok(product.trim(), `empty product mapping: ${id}`);
      assert.equal(product, product.normalize("NFC"), `product must use NFC: ${product}`);
    }

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
});
