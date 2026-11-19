import { readdir, readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { importProductImage, readManifest } from "./product-image-files.ts";

const root = resolve(import.meta.dirname, "..");
const sourceDirectory = resolve(root, process.argv[2] || "tools/product-image-studio/results");
const files = (await readdir(sourceDirectory))
  .filter((file) => extname(file).toLowerCase() === ".png")
  .sort();
if (!files.length) throw new Error("Keine PNG-Dateien im Quellverzeichnis gefunden.");
for (const file of files) {
  const id = basename(file, extname(file));
  const manifest = await readManifest(resolve(root, "public/images/product-images.json"));
  const name = manifest.products.find((product) => product.id === id)?.names[0] || id;
  await importProductImage(root, name, await readFile(resolve(sourceDirectory, file)));
}
console.info(
  `${files.length} Produktbilder importiert; vorhandene Katalogbilder bleiben erhalten.`,
);
