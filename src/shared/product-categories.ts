export type ProductCategory =
  | "bakery"
  | "canned"
  | "dairy"
  | "drinks"
  | "frozen"
  | "household"
  | "meat"
  | "pet"
  | "produce"
  | "spices"
  | "staples";

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
  const normalized = name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
  const words = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

  for (const rule of categoryKeywords) {
    if (rule.keywords.some((keyword) => matchesKeyword(normalized, words, keyword))) {
      return rule.category;
    }
  }
  return undefined;
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
