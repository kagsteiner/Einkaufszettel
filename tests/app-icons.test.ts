import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import sharp from "sharp";

const expectedPngs = [
  ["favicon-16x16.png", 16],
  ["favicon-32x32.png", 32],
  ["apple-touch-icon.png", 180],
  ["android-chrome-192x192.png", 192],
  ["android-chrome-512x512.png", 512],
  ["android-chrome-maskable-512x512.png", 512],
] as const;

test("generated browser and app icons have their declared dimensions", async () => {
  for (const [name, size] of expectedPngs) {
    const metadata = await sharp(resolve("public", name)).metadata();
    assert.equal(metadata.format, "png", name);
    assert.equal(metadata.width, size, name);
    assert.equal(metadata.height, size, name);
  }
});

test("favicon.ico contains 16, 32 and 48 pixel PNG images", async () => {
  const icon = await readFile(resolve("public", "favicon.ico"));
  assert.equal(icon.readUInt16LE(0), 0);
  assert.equal(icon.readUInt16LE(2), 1);
  assert.equal(icon.readUInt16LE(4), 3);
  assert.deepEqual(
    [0, 1, 2].map((index) => icon.readUInt8(6 + index * 16)),
    [16, 32, 48],
  );
  for (const index of [0, 1, 2]) {
    const imageOffset = icon.readUInt32LE(6 + index * 16 + 12);
    assert.deepEqual(
      [...icon.subarray(imageOffset, imageOffset + 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
  }
});
