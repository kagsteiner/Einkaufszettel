import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import {
  createProductImageCatalog,
  normalizeProductName,
} from "../src/shared/product-image-catalog.ts";

export interface ProductImageEntry {
  id: string;
  file: string;
}

export interface ProductEntry {
  id: string;
  names: string[];
  image?: string;
  imageFallback?: string;
}

export interface ProductImageManifest {
  version: 2;
  images: ProductImageEntry[];
  products: ProductEntry[];
}

export async function readManifest(path: string): Promise<ProductImageManifest> {
  let document: unknown;
  try {
    document = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { version: 2, images: [], products: [] };
    throw error;
  }
  if (
    !isRecord(document) ||
    !Array.isArray(document.images) ||
    ![1, 2].includes(Number(document.version))
  ) {
    throw new Error("Ungültiger Bildkatalog.");
  }
  const images = document.images.map((image): ProductImageEntry => {
    if (
      !isRecord(image) ||
      !isCatalogId(image.id) ||
      typeof image.file !== "string" ||
      !/^images\/products\/[a-z0-9-]+\.jpg$/.test(image.file)
    )
      throw new Error("Ungültiges Katalogbild.");
    return { id: image.id, file: image.file };
  });
  if (document.version === 2 && !Array.isArray(document.products))
    throw new Error("Produktknoten fehlen.");
  const products =
    document.version === 1
      ? document.images.map(parseLegacyProduct)
      : (document.products as unknown[]).map(parseProduct);
  const manifest = { version: 2 as const, images, products };
  validateManifest(manifest);
  return manifest;
}

export function validateManifest(manifest: ProductImageManifest): void {
  const catalog = createProductImageCatalog(manifest);
  const names = new Set<string>();
  if (
    catalog.products.size !== manifest.products.length ||
    catalog.images.size !== manifest.images.length ||
    new Set(manifest.images.map((image) => image.file)).size !== manifest.images.length
  )
    throw new Error("Doppelte Katalog-IDs oder Dateien.");
  for (const product of manifest.products) {
    for (const name of product.names) {
      const normalized = normalizeProductName(name);
      if (names.has(normalized)) throw new Error("Doppelter Produktname im Bildkatalog.");
      names.add(normalized);
    }
    const visited = new Set<string>();
    let current: ProductEntry | undefined = product;
    while (current) {
      if (visited.has(current.id)) throw new Error("Zyklischer Bildfallback.");
      visited.add(current.id);
      if (current.image && !catalog.images.has(current.image))
        throw new Error("Bildreferenz fehlt.");
      if (!current.imageFallback) break;
      const next: ProductEntry | undefined = manifest.products.find(
        (entry) => entry.id === current?.imageFallback,
      );
      if (!next) throw new Error("Fallbackreferenz fehlt.");
      current = next;
    }
  }
}

export function productForName(manifest: ProductImageManifest, name: string): ProductEntry {
  const normalized = normalizeProductName(name);
  if (!normalized || normalized.length > 120) throw new Error("Ungültiger Produktname.");
  const existing = manifest.products.find((product) =>
    product.names.some((value) => normalizeProductName(value) === normalized),
  );
  if (existing?.id === "unbekannt")
    throw new Error("Das allgemeine Platzhalterbild darf nicht ersetzt werden.");
  if (existing) return existing;
  const id = toAssetId(normalized);
  if (
    !id ||
    manifest.products.some((product) => product.id === id) ||
    manifest.images.some((image) => image.id === id)
  ) {
    throw new Error(
      "Produktname ergibt eine bereits belegte oder ungültige Bild-ID. Bitte vorhandene Zuordnung prüfen.",
    );
  }
  const product = { id, names: [name.trim().normalize("NFC")] };
  manifest.products.push(product);
  return product;
}

export async function saveManifest(path: string, manifest: ProductImageManifest): Promise<void> {
  validateManifest(manifest);
  manifest.images.sort((a, b) => a.id.localeCompare(b.id, "de"));
  manifest.products.sort((a, b) => a.id.localeCompare(b.id, "de"));
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, serializeManifest(manifest), "utf8");
  await rename(temporary, path);
}

export async function prepareProductJpeg(source: Buffer): Promise<Buffer> {
  return sharp(source)
    .rotate()
    .resize(768, 768, { background: "#faf7ef", fit: "contain", kernel: sharp.kernel.lanczos3 })
    .flatten({ background: "#faf7ef" })
    .jpeg({ chromaSubsampling: "4:2:0", mozjpeg: true, progressive: true, quality: 84 })
    .toBuffer();
}

export async function importProductImage(
  root: string,
  name: string,
  source: Buffer,
): Promise<void> {
  const manifestPath = resolve(root, "public/images/product-images.json");
  const manifest = await readManifest(manifestPath);
  const product = productForName(manifest, name);
  const id = product.id;
  product.image = id;
  const file = `images/products/${id}.jpg`;
  const existingImage = manifest.images.find((image) => image.id === id);
  if (existingImage) existingImage.file = file;
  else manifest.images.push({ id, file });
  validateManifest(manifest);
  const jpeg = await prepareProductJpeg(source);
  const sourceDirectory = resolve(root, "tools/product-image-studio/results");
  const targetDirectory = resolve(root, "public/images/products");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(targetDirectory, { recursive: true });
  // Write complete files before advertising the asset in the catalog.
  const target = resolve(root, "public", file);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, jpeg);
  await writeFile(resolve(sourceDirectory, `${id}.png`), source);
  await rename(temporary, target);
  await saveManifest(manifestPath, manifest);
}

export async function assignProductImage(
  root: string,
  name: string,
  imageId: string,
): Promise<void> {
  const path = resolve(root, "public/images/product-images.json");
  const manifest = await readManifest(path);
  if (!manifest.images.some((image) => image.id === imageId) || imageId === "unbekannt")
    throw new Error("Bitte ein vorhandenes Produktbild auswählen.");
  productForName(manifest, name).image = imageId;
  await saveManifest(path, manifest);
}

export function toAssetId(productName: string): string {
  return productName
    .toLocaleLowerCase("de-DE")
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function serializeManifest(manifest: ProductImageManifest): string {
  const images = manifest.images
    .map((image) =>
      [
        "    {",
        `      "id": ${JSON.stringify(image.id)},`,
        `      "file": ${JSON.stringify(image.file)}`,
        "    }",
      ].join("\n"),
    )
    .join(",\n");
  const products = manifest.products
    .map((product) => {
      const fields = [
        `      "id": ${JSON.stringify(product.id)}`,
        serializeStringArray("names", product.names),
      ];
      if (product.image) {
        fields.push(`      "image": ${JSON.stringify(product.image)}`);
      }
      if (product.imageFallback) {
        fields.push(`      "imageFallback": ${JSON.stringify(product.imageFallback)}`);
      }
      return ["    {", fields.join(",\n"), "    }"].join("\n");
    })
    .join(",\n");
  return `{\n  "version": 2,\n  "images": [\n${images}\n  ],\n  "products": [\n${products}\n  ]\n}\n`;
}

function serializeStringArray(field: string, values: string[]): string {
  const compact = `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
  const compactLine = `      ${JSON.stringify(field)}: ${compact}`;
  if (compactLine.length <= 100) {
    return compactLine;
  }
  return [
    `      ${JSON.stringify(field)}: [`,
    ...values.map((value, index) => {
      const comma = index === values.length - 1 ? "" : ",";
      return `        ${JSON.stringify(value)}${comma}`;
    }),
    "      ]",
  ].join("\n");
}

function parseLegacyProduct(value: unknown): ProductEntry {
  if (
    !isRecord(value) ||
    !isCatalogId(value.id) ||
    !Array.isArray(value.products) ||
    !isNameArray(value.products)
  ) {
    throw new Error("Der alte Bildkatalog enthält einen ungültigen Produkteintrag.");
  }
  return {
    id: value.id,
    image: value.id,
    names: value.products.map((name) => name.normalize("NFC")),
  };
}

function parseProduct(value: unknown): ProductEntry {
  if (
    !isRecord(value) ||
    !isCatalogId(value.id) ||
    !Array.isArray(value.names) ||
    !isNameArray(value.names)
  ) {
    throw new Error("Der Bildkatalog enthält einen ungültigen visuellen Produktknoten.");
  }
  const image = value.image === undefined ? undefined : parseReference(value.image, "image");
  const imageFallback =
    value.imageFallback === undefined
      ? undefined
      : parseReference(value.imageFallback, "imageFallback");
  if (!image && !imageFallback) {
    throw new Error(`Produktknoten "${value.id}" benötigt image oder imageFallback.`);
  }
  return {
    id: value.id,
    image,
    imageFallback,
    names: value.names.map((name) => name.normalize("NFC")),
  };
}

function parseReference(value: unknown, field: string): string {
  if (!isCatalogId(value)) {
    throw new Error(`Der Katalog enthält eine ungültige ${field}-Referenz.`);
  }
  return value;
}

function isNameArray(values: unknown[]): values is string[] {
  return (
    values.length > 0 && values.every((value) => typeof value === "string" && Boolean(value.trim()))
  );
}

function isCatalogId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
