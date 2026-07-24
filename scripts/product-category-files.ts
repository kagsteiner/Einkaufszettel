import type Database from "better-sqlite3";
import {
  isProductCategory,
  normalizeProductName,
  type ProductCategory,
  type ProductCategoryCatalog,
} from "../src/shared/product-categories.ts";

export type ProductCategoryCandidateFile = Readonly<{
  conflicts?: ReadonlyArray<
    Readonly<{
      categories: ReadonlyArray<ProductCategory>;
      name: string;
    }>
  >;
  products: ReadonlyArray<Readonly<{ category: ProductCategory; name: string }>>;
  version: 1;
}>;

type KnowledgeRow = {
  category: string;
  name: string;
  updated_at: string;
};

export function exportProductCategoryKnowledge(
  database: Database.Database,
): ProductCategoryCandidateFile {
  const rows = database
    .prepare(
      `SELECT name, category, updated_at
       FROM household_product_categories
       ORDER BY updated_at DESC, normalized_name`,
    )
    .all() as KnowledgeRow[];
  const grouped = new Map<string, KnowledgeRow[]>();
  for (const row of rows) {
    if (!isProductCategory(row.category)) {
      throw new Error(`Ungültige Kategorie „${row.category}“ für „${row.name}“ in der Datenbank.`);
    }
    const normalizedName = normalizeProductName(row.name);
    const entries = grouped.get(normalizedName) || [];
    entries.push(row);
    grouped.set(normalizedName, entries);
  }

  const products: Array<{ category: ProductCategory; name: string }> = [];
  const conflicts: Array<{ categories: ProductCategory[]; name: string }> = [];
  for (const entries of grouped.values()) {
    const first = entries[0];
    if (!first) {
      continue;
    }
    const categories = [
      ...new Set(entries.map((entry) => entry.category as ProductCategory)),
    ].sort();
    if (categories.length > 1) {
      conflicts.push({ categories, name: first.name });
    } else {
      const category = categories[0];
      if (category) {
        products.push({ category, name: first.name });
      }
    }
  }

  products.sort(compareProductNames);
  conflicts.sort((left, right) => compareNames(left.name, right.name));
  return {
    ...(conflicts.length > 0 ? { conflicts } : {}),
    products,
    version: 1,
  };
}

export function mergeProductCategoryCatalog(
  currentValue: unknown,
  candidateValue: unknown,
): ProductCategoryCatalog {
  const current = parseProductFile(currentValue, "Der bestehende Produktkatalog");
  const candidate = parseCandidateFile(candidateValue);
  if (candidate.conflicts && candidate.conflicts.length > 0) {
    throw new Error(
      `Der Export enthält ungelöste Konflikte: ${candidate.conflicts
        .map((conflict) => conflict.name)
        .join(", ")}`,
    );
  }

  const merged = new Map(
    current.products.map((product) => [
      normalizeProductName(product.name),
      { category: product.category, name: product.name },
    ]),
  );
  const conflicts: string[] = [];
  for (const product of candidate.products) {
    const normalizedName = normalizeProductName(product.name);
    const existing = merged.get(normalizedName);
    if (existing && existing.category !== product.category) {
      conflicts.push(`${product.name}: Katalog=${existing.category}, Export=${product.category}`);
    } else if (!existing) {
      merged.set(normalizedName, { category: product.category, name: product.name });
    }
  }
  if (conflicts.length > 0) {
    throw new Error(`Katalogkonflikte:\n${conflicts.join("\n")}`);
  }

  return {
    products: [...merged.values()].sort(compareProductNames),
    version: 1,
  };
}

export function parseCandidateFile(value: unknown): ProductCategoryCandidateFile {
  const parsed = parseProductFile(value, "Der Produktwissen-Export");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return parsed;
  }
  const conflictsValue = (value as { conflicts?: unknown }).conflicts;
  if (conflictsValue === undefined) {
    return parsed;
  }
  if (!Array.isArray(conflictsValue)) {
    throw new Error("Die Konfliktliste im Produktwissen-Export ist ungültig.");
  }
  const conflicts = conflictsValue.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Der Produktwissen-Export enthält einen ungültigen Konflikt.");
    }
    const conflict = value as { categories?: unknown; name?: unknown };
    if (
      typeof conflict.name !== "string" ||
      !conflict.name.trim() ||
      !Array.isArray(conflict.categories) ||
      conflict.categories.length < 2 ||
      !conflict.categories.every(isProductCategory)
    ) {
      throw new Error("Der Produktwissen-Export enthält einen ungültigen Konflikt.");
    }
    return {
      categories: [...new Set(conflict.categories)].sort(),
      name: conflict.name,
    };
  });
  return { ...parsed, conflicts };
}

function parseProductFile(value: unknown, label: string): ProductCategoryCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} ist ungültig.`);
  }
  const file = value as { products?: unknown; version?: unknown };
  if (file.version !== 1 || !Array.isArray(file.products)) {
    throw new Error(`${label} verwendet ein unbekanntes Format.`);
  }
  const seen = new Map<string, ProductCategory>();
  const products = file.products.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${label} enthält einen ungültigen Produkteintrag.`);
    }
    const product = value as { category?: unknown; name?: unknown };
    if (
      typeof product.name !== "string" ||
      !product.name.trim() ||
      product.name.length > 120 ||
      !isProductCategory(product.category)
    ) {
      throw new Error(`${label} enthält einen ungültigen Produkteintrag.`);
    }
    const normalizedName = normalizeProductName(product.name);
    const existing = seen.get(normalizedName);
    if (existing) {
      throw new Error(`${label} enthält „${product.name}“ mehrfach.`);
    }
    seen.set(normalizedName, product.category);
    return { category: product.category, name: product.name };
  });
  return { products, version: 1 };
}

function compareProductNames(
  left: Readonly<{ name: string }>,
  right: Readonly<{ name: string }>,
): number {
  return compareNames(left.name, right.name);
}

function compareNames(left: string, right: string): number {
  return normalizeProductName(left).localeCompare(normalizeProductName(right), "de");
}
