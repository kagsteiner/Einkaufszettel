export const unknownProductImageFile = "images/products/unbekannt.jpg";

export function normalizeProductName(value: string): string {
  return value.trim().normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
}

export function createProductImageCatalog(document: unknown): ReadonlyMap<string, string> {
  const catalog = new Map<string, string>();
  if (!isRecord(document) || !Array.isArray(document.images)) {
    return catalog;
  }

  for (const candidate of document.images) {
    if (
      !isRecord(candidate) ||
      typeof candidate.file !== "string" ||
      !/^images\/products\/[a-z0-9-]+\.jpg$/.test(candidate.file) ||
      !Array.isArray(candidate.products)
    ) {
      continue;
    }
    for (const product of candidate.products) {
      if (typeof product !== "string") {
        continue;
      }
      const normalized = normalizeProductName(product);
      if (normalized && !catalog.has(normalized)) {
        catalog.set(normalized, candidate.file);
      }
    }
  }
  return catalog;
}

export function productImageFile(
  catalog: ReadonlyMap<string, string>,
  productName: string,
): string {
  return catalog.get(normalizeProductName(productName)) || unknownProductImageFile;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
