import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import sharp from "sharp";

interface ProductImageEntry {
  id: string;
  file: string;
  products: string[];
}

interface ProductImageManifest {
  version: 1;
  images: ProductImageEntry[];
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
const existingProducts = await readExistingProducts(manifestPath);
const usedIds = new Set<string>();
const images: ProductImageEntry[] = [];

for (const sourceFile of sourceFiles) {
  const productName = basename(sourceFile, extname(sourceFile)).normalize("NFC");
  const id = toAssetId(productName);
  if (!id) {
    throw new Error(`Aus "${sourceFile}" konnte keine stabile Bild-ID erzeugt werden.`);
  }
  if (usedIds.has(id)) {
    throw new Error(`Mehrere Quelldateien ergeben dieselbe Bild-ID "${id}".`);
  }
  usedIds.add(id);

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
    products: existingProducts.get(id) || [productName],
  });
}

const manifest: ProductImageManifest = {
  version: 1,
  images,
};
await writeFile(manifestPath, serializeManifest(manifest), "utf8");

console.info(
  `${images.length} Produktbilder nach public/images/products importiert; Mapping: public/images/product-images.json`,
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
  const entries = manifest.images
    .map((image) => {
      const compactProducts = JSON.stringify(image.products);
      const productsLine = `      "products": ${compactProducts}`;
      const serializedProducts =
        productsLine.length <= 100
          ? productsLine
          : [
              '      "products": [',
              ...image.products.map((product, index) => {
                const comma = index === image.products.length - 1 ? "" : ",";
                return `        ${JSON.stringify(product)}${comma}`;
              }),
              "      ]",
            ].join("\n");
      return [
        "    {",
        `      "id": ${JSON.stringify(image.id)},`,
        `      "file": ${JSON.stringify(image.file)},`,
        serializedProducts,
        "    }",
      ].join("\n");
    })
    .join(",\n");
  return `{\n  "version": 1,\n  "images": [\n${entries}\n  ]\n}\n`;
}

async function readExistingProducts(path: string): Promise<Map<string, string[]>> {
  let document: unknown;
  try {
    document = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Map();
    }
    throw error;
  }

  if (!isRecord(document) || !Array.isArray(document.images)) {
    throw new Error(`Das vorhandene Mapping ${path} hat kein gültiges images-Array.`);
  }

  const products = new Map<string, string[]>();
  for (const entry of document.images) {
    if (
      isRecord(entry) &&
      typeof entry.id === "string" &&
      Array.isArray(entry.products) &&
      entry.products.length > 0 &&
      entry.products.every((product) => typeof product === "string" && product.trim())
    ) {
      products.set(
        entry.id,
        entry.products.map((product) => product.normalize("NFC")),
      );
    }
  }
  return products;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
