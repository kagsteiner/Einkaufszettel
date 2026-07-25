import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import sharp from "sharp";

interface ProductImageEntry {
  id: string;
  file: string;
}

interface ProductEntry {
  id: string;
  names: string[];
  image?: string;
  imageFallback?: string;
}

interface ProductImageManifest {
  version: 2;
  images: ProductImageEntry[];
  products: ProductEntry[];
}

const projectRoot = resolve(import.meta.dirname, "..");
const sourceDirectory = resolve(
  projectRoot,
  process.argv[2] || "tools/product-image-studio/results",
);
const publicImagesDirectory = resolve(projectRoot, "public/images");
const outputDirectory = resolve(publicImagesDirectory, "products");
const manifestPath = resolve(publicImagesDirectory, "product-images.json");

const sourceFiles = (await readdir(sourceDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".png")
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right, "de"));

if (sourceFiles.length === 0) {
  throw new Error(`Keine PNG-Dateien in ${sourceDirectory} gefunden.`);
}

await mkdir(outputDirectory, { recursive: true });
const products = await readExistingProducts(manifestPath);
const productsById = new Map(products.map((product) => [product.id, product]));
if (productsById.size !== products.length) {
  throw new Error("Der Bildkatalog enthält doppelte visuelle Produkt-IDs.");
}
const usedImageIds = new Set<string>();
const images: ProductImageEntry[] = [];

for (const sourceFile of sourceFiles) {
  const productName = basename(sourceFile, extname(sourceFile)).normalize("NFC");
  const id = toAssetId(productName);
  if (!id) {
    throw new Error(`Aus "${sourceFile}" konnte keine stabile Bild-ID erzeugt werden.`);
  }
  if (usedImageIds.has(id)) {
    throw new Error(`Mehrere Quelldateien ergeben dieselbe Bild-ID "${id}".`);
  }
  usedImageIds.add(id);

  const outputFile = `${id}.jpg`;
  await sharp(resolve(sourceDirectory, sourceFile))
    .rotate()
    .resize(768, 768, {
      background: "#faf7ef",
      fit: "contain",
      kernel: sharp.kernel.lanczos3,
    })
    .flatten({ background: "#faf7ef" })
    .jpeg({
      chromaSubsampling: "4:2:0",
      mozjpeg: true,
      progressive: true,
      quality: 84,
    })
    .toFile(resolve(outputDirectory, outputFile));

  images.push({
    id,
    file: `images/products/${outputFile}`,
  });
  const existingProduct = productsById.get(id);
  if (!existingProduct) {
    const product = {
      id,
      image: id,
      names: [productName],
    };
    products.push(product);
    productsById.set(id, product);
  } else if (!existingProduct.image) {
    existingProduct.image = id;
  }
}

products.sort((left, right) => left.id.localeCompare(right.id, "de"));
const manifest: ProductImageManifest = {
  version: 2,
  images,
  products,
};
await writeFile(manifestPath, serializeManifest(manifest), "utf8");

console.info(
  `${images.length} Produktbilder und ${products.length} visuelle Produktknoten importiert; Katalog: public/images/product-images.json`,
);

function toAssetId(productName: string): string {
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

function serializeManifest(manifest: ProductImageManifest): string {
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

async function readExistingProducts(path: string): Promise<ProductEntry[]> {
  let document: unknown;
  try {
    document = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  if (!isRecord(document)) {
    throw new Error(`Der vorhandene Katalog ${path} ist kein JSON-Objekt.`);
  }
  if (document.version === 1 && Array.isArray(document.images)) {
    return document.images.map(parseLegacyProduct);
  }
  if (document.version === 2 && Array.isArray(document.products)) {
    return document.products.map(parseProduct);
  }
  throw new Error(`Der vorhandene Katalog ${path} verwendet weder Version 1 noch Version 2.`);
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
