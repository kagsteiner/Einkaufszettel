export const unknownProductImageFile = "images/products/unbekannt.jpg";

interface ProductImageNode {
  image?: string;
  imageFallback?: string;
}

export interface ProductImageCatalog {
  readonly images: ReadonlyMap<string, string>;
  readonly productIdsByName: ReadonlyMap<string, string>;
  readonly products: ReadonlyMap<string, ProductImageNode>;
}

export function normalizeProductName(value: string): string {
  return value.trim().normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
}

export function createProductImageCatalog(document: unknown): ProductImageCatalog {
  if (!isRecord(document) || !Array.isArray(document.images)) {
    return emptyCatalog();
  }
  if (document.version === 1) {
    return createLegacyCatalog(document.images);
  }
  if (document.version !== 2 || !Array.isArray(document.products)) {
    return emptyCatalog();
  }

  const images = new Map<string, string>();
  for (const candidate of document.images) {
    if (
      isRecord(candidate) &&
      isCatalogId(candidate.id) &&
      typeof candidate.file === "string" &&
      /^images\/products\/[a-z0-9-]+\.jpg$/.test(candidate.file) &&
      !images.has(candidate.id)
    ) {
      images.set(candidate.id, candidate.file);
    }
  }

  const productIdsByName = new Map<string, string>();
  const products = new Map<string, ProductImageNode>();
  for (const candidate of document.products) {
    if (
      !isRecord(candidate) ||
      !isCatalogId(candidate.id) ||
      !Array.isArray(candidate.names) ||
      products.has(candidate.id)
    ) {
      continue;
    }
    const image = isCatalogId(candidate.image) ? candidate.image : undefined;
    const imageFallback = isCatalogId(candidate.imageFallback)
      ? candidate.imageFallback
      : undefined;
    if (!image && !imageFallback) {
      continue;
    }
    products.set(candidate.id, { image, imageFallback });
    addNames(productIdsByName, candidate.id, candidate.names);
  }
  return { images, productIdsByName, products };
}

export function productImageFile(catalog: ProductImageCatalog, productName: string): string {
  let productId = catalog.productIdsByName.get(normalizeProductName(productName));
  const visited = new Set<string>();
  while (productId && !visited.has(productId)) {
    visited.add(productId);
    const product = catalog.products.get(productId);
    if (!product) {
      break;
    }
    if (product.image) {
      const file = catalog.images.get(product.image);
      if (file) {
        return file;
      }
    }
    productId = product.imageFallback;
  }
  return unknownProductImageFile;
}

function createLegacyCatalog(candidates: unknown[]): ProductImageCatalog {
  const images = new Map<string, string>();
  const productIdsByName = new Map<string, string>();
  const products = new Map<string, ProductImageNode>();
  for (const candidate of candidates) {
    if (
      !isRecord(candidate) ||
      !isCatalogId(candidate.id) ||
      typeof candidate.file !== "string" ||
      !/^images\/products\/[a-z0-9-]+\.jpg$/.test(candidate.file) ||
      !Array.isArray(candidate.products) ||
      products.has(candidate.id)
    ) {
      continue;
    }
    images.set(candidate.id, candidate.file);
    products.set(candidate.id, { image: candidate.id });
    addNames(productIdsByName, candidate.id, candidate.products);
  }
  return { images, productIdsByName, products };
}

function addNames(target: Map<string, string>, productId: string, candidates: unknown[]): void {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const normalized = normalizeProductName(candidate);
    if (normalized && !target.has(normalized)) {
      target.set(normalized, productId);
    }
  }
}

function emptyCatalog(): ProductImageCatalog {
  return {
    images: new Map(),
    productIdsByName: new Map(),
    products: new Map(),
  };
}

function isCatalogId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
