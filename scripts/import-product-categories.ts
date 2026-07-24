import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { mergeProductCategoryCatalog } from "./product-category-files.ts";

const options = parseOptions(process.argv.slice(2));
if (!options) {
  printUsage();
  process.exitCode = 2;
} else {
  const inputPath = resolve(options.input);
  const catalogPath = resolve(options.catalog || "src/shared/product-category-catalog.json");
  const [input, catalog] = await Promise.all([readJson(inputPath), readJson(catalogPath)]);
  const merged = mergeProductCategoryCatalog(catalog, input);
  const previousCount = getProductCount(catalog);
  await writeFile(catalogPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  console.info(
    `${merged.products.length - previousCount} neue Produktzuordnung(en) in ${catalogPath} übernommen.`,
  );
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `${path} konnte nicht als JSON gelesen werden: ${
        error instanceof Error ? error.message : "unbekannter Fehler"
      }`,
    );
  }
}

function getProductCount(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return 0;
  }
  const products = (value as { products?: unknown }).products;
  return Array.isArray(products) ? products.length : 0;
}

function parseOptions(values: string[]): { catalog?: string; input: string } | null {
  let catalog: string | undefined;
  let input: string | undefined;
  for (let index = 0; index < values.length; index += 2) {
    const value = values[index + 1];
    if (!value) {
      return null;
    }
    if (values[index] === "--catalog") {
      catalog = value;
    } else if (values[index] === "--input") {
      input = value;
    } else {
      return null;
    }
  }
  return input ? { catalog, input } : null;
}

function printUsage(): void {
  console.info(`Produktwissen in den allgemeinen Katalog übernehmen:
  npm run categories:import -- --input <export.json>
  npm run categories:import -- --input <export.json> --catalog <katalog.json>`);
}
