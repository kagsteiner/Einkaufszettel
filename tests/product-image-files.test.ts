import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  assignProductImage,
  importProductImage,
  readManifest,
} from "../scripts/product-image-files.ts";

test("adopting a single image preserves other assets, aliases and fallbacks without requiring their PNG sources", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "image-adopt-"));
  const path = resolve(root, "public/images/product-images.json");
  try {
    await mkdir(resolve(root, "public/images/products"), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        version: 2,
        images: [{ id: "kaese", file: "images/products/kaese.jpg" }],
        products: [
          { id: "kaese", image: "kaese", names: ["Käse"] },
          { id: "mozzarella", imageFallback: "kaese", names: ["Mozzarella", "Mozzarellas"] },
        ],
      }),
    );
    await writeFile(resolve(root, "public/images/products/kaese.jpg"), "do not rewrite");
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "red" } })
      .png()
      .toBuffer();
    await importProductImage(root, "Mozzarella", png);
    let manifest = await readManifest(path);
    assert.equal(manifest.images.length, 2);
    assert.deepEqual(
      manifest.products.find((product) => product.id === "mozzarella"),
      {
        id: "mozzarella",
        names: ["Mozzarella", "Mozzarellas"],
        image: "mozzarella",
        imageFallback: "kaese",
      },
    );
    assert.equal(
      await readFile(resolve(root, "public/images/products/kaese.jpg"), "utf8"),
      "do not rewrite",
    );
    const meta = await sharp(resolve(root, "public/images/products/mozzarella.jpg")).metadata();
    assert.equal(meta.width, 768);
    assert.equal(meta.height, 768);
    assert.equal(meta.format, "jpeg");
    assert.deepEqual(
      await readFile(resolve(root, "tools/product-image-studio/results/mozzarella.png")),
      png,
    );
    await assignProductImage(root, "Tippfehler Käse", "kaese");
    manifest = await readManifest(path);
    assert.equal(
      manifest.products.find((product) => product.names.includes("Tippfehler Käse"))?.image,
      "kaese",
    );
    const before = await readFile(path, "utf8");
    await assert.rejects(importProductImage(root, "Neues Produkt", Buffer.from("invalid")));
    await assert.rejects(assignProductImage(root, "Andere", "missing"));
    await assert.rejects(importProductImage(root, "Kaese", png), /belegte/);
    assert.equal(await readFile(path, "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
