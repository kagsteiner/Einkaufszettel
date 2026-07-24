import productCategoryCatalog from "./product-category-catalog.json" with { type: "json" };

export const productCategories = [
  "produce",
  "dairy",
  "bakery",
  "meat",
  "staples",
  "canned",
  "spices",
  "drinks",
  "pet",
  "household",
  "frozen",
  "other",
] as const;

export type ProductCategory = (typeof productCategories)[number];

export type ProductCategoryCatalog = Readonly<{
  products: ReadonlyArray<Readonly<{ category: ProductCategory; name: string }>>;
  version: 1;
}>;

const productCategorySet = new Set<string>(productCategories);
const exactProductCategories = loadExactProductCategories(productCategoryCatalog);

const categoryKeywords: ReadonlyArray<
  Readonly<{ category: ProductCategory; keywords: ReadonlyArray<string> }>
> = [
  {
    category: "frozen",
    keywords: ["tiefkühl", "tiefgekühlt", "tk"],
  },
  {
    category: "household",
    keywords: [
      "batterie",
      "handseife",
      "klopapier",
      "reiniger",
      "seife",
      "shampoo",
      "spülmittel",
      "toilettenpapier",
      "waschmittel",
      "zahnbürste",
      "zahnpasta",
    ],
  },
  {
    category: "pet",
    keywords: ["hundefutter", "katzenfutter", "tierfutter"],
  },
  {
    category: "drinks",
    keywords: [
      "bier",
      "cola",
      "getränk",
      "limonade",
      "mineralwasser",
      "saft",
      "sekt",
      "wasser",
      "wein",
    ],
  },
  {
    category: "dairy",
    keywords: [
      "butter",
      "ei",
      "eier",
      "joghurt",
      "käse",
      "milch",
      "mozzarella",
      "parmesan",
      "quark",
      "sahne",
      "schmand",
    ],
  },
  {
    category: "bakery",
    keywords: ["baguette", "brot", "brötchen", "brezel", "croissant", "kuchen", "semmel", "torte"],
  },
  {
    category: "meat",
    keywords: [
      "fisch",
      "fleisch",
      "garnele",
      "hackfleisch",
      "hähnchen",
      "lachs",
      "pute",
      "schinken",
      "schwein",
      "wurst",
    ],
  },
  {
    category: "canned",
    keywords: ["dose", "dosentomate", "konserve"],
  },
  {
    category: "spices",
    keywords: [
      "basilikum",
      "dill",
      "gewürz",
      "kräuter",
      "oregano",
      "pfeffer",
      "piment",
      "rosmarin",
      "safran",
      "salbei",
      "salz",
      "thymian",
    ],
  },
  {
    category: "produce",
    keywords: [
      "apfel",
      "aubergine",
      "avocado",
      "banane",
      "beere",
      "birne",
      "blumenkohl",
      "bohne",
      "champignon",
      "erbse",
      "erdbeere",
      "fenchel",
      "gemüse",
      "gurke",
      "kartoffel",
      "knoblauch",
      "lauch",
      "limette",
      "mandarine",
      "mango",
      "melone",
      "möhre",
      "olive",
      "orange",
      "paprika",
      "pfirsich",
      "pilz",
      "radieschen",
      "salat",
      "spinat",
      "tomate",
      "traube",
      "zitrone",
      "zucchini",
      "zwiebel",
    ],
  },
  {
    category: "staples",
    keywords: [
      "essig",
      "gnocchi",
      "haferflocken",
      "mehl",
      "müsli",
      "nudel",
      "öl",
      "pasta",
      "reis",
      "senf",
      "zucker",
    ],
  },
];

const commonInflectionEndings = ["e", "en", "n", "er", "s"];

export function inferProductCategory(name: string): ProductCategory | undefined {
  const normalized = normalizeProductName(name);
  const exactCategory = exactProductCategories.get(normalized);
  if (exactCategory) {
    return exactCategory;
  }
  const words = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

  for (const rule of categoryKeywords) {
    if (rule.keywords.some((keyword) => matchesKeyword(normalized, words, keyword))) {
      return rule.category;
    }
  }
  return undefined;
}

export function isProductCategory(value: unknown): value is ProductCategory {
  return typeof value === "string" && productCategorySet.has(value);
}

export function normalizeProductName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
}

function loadExactProductCategories(value: unknown): ReadonlyMap<string, ProductCategory> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Der Produktkatalog ist ungültig.");
  }
  const catalog = value as { products?: unknown; version?: unknown };
  if (catalog.version !== 1 || !Array.isArray(catalog.products)) {
    throw new Error("Der Produktkatalog verwendet ein unbekanntes Format.");
  }

  const result = new Map<string, ProductCategory>();
  for (const product of catalog.products) {
    if (!product || typeof product !== "object" || Array.isArray(product)) {
      throw new Error("Der Produktkatalog enthält einen ungültigen Eintrag.");
    }
    const entry = product as { category?: unknown; name?: unknown };
    if (
      typeof entry.name !== "string" ||
      !entry.name.trim() ||
      entry.name.length > 120 ||
      !isProductCategory(entry.category)
    ) {
      throw new Error("Der Produktkatalog enthält einen ungültigen Eintrag.");
    }
    const normalizedName = normalizeProductName(entry.name);
    if (result.has(normalizedName)) {
      throw new Error(`Der Produktkatalog enthält „${entry.name}“ mehrfach.`);
    }
    result.set(normalizedName, entry.category);
  }
  return result;
}

function matchesKeyword(
  normalized: string,
  words: ReadonlyArray<string>,
  keyword: string,
): boolean {
  return (
    normalized === keyword ||
    words.includes(keyword) ||
    (keyword.length >= 4 &&
      words.some(
        (word) =>
          word.endsWith(keyword) ||
          commonInflectionEndings.some((ending) => word.endsWith(`${keyword}${ending}`)) ||
          (keyword === "tiefkühl" && word.startsWith(keyword)),
      ))
  );
}
