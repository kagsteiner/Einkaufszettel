export type UnitDefinition = Readonly<{
  aliases: ReadonlyArray<string>;
  baseUnit?: string;
  dimension: string;
  factorToBase?: number;
  id: string;
  plural: string;
  singular: string;
}>;

export const unitDefinitions: ReadonlyArray<UnitDefinition> = [
  {
    aliases: ["g", "gramm"],
    baseUnit: "g",
    dimension: "mass",
    factorToBase: 1,
    id: "g",
    plural: "g",
    singular: "g",
  },
  {
    aliases: ["kg", "kilogramm"],
    baseUnit: "g",
    dimension: "mass",
    factorToBase: 1_000,
    id: "kg",
    plural: "kg",
    singular: "kg",
  },
  {
    aliases: ["ml", "milliliter"],
    baseUnit: "ml",
    dimension: "volume",
    factorToBase: 1,
    id: "ml",
    plural: "ml",
    singular: "ml",
  },
  {
    aliases: ["l", "liter"],
    baseUnit: "ml",
    dimension: "volume",
    factorToBase: 1_000,
    id: "l",
    plural: "l",
    singular: "l",
  },
  {
    aliases: ["tl", "teelöffel", "teeloeffel", "tsp"],
    baseUnit: "ml",
    dimension: "volume",
    factorToBase: 5,
    id: "tl",
    plural: "TL",
    singular: "TL",
  },
  {
    aliases: ["el", "esslöffel", "essloeffel", "tbsp"],
    baseUnit: "ml",
    dimension: "volume",
    factorToBase: 15,
    id: "el",
    plural: "EL",
    singular: "EL",
  },
  {
    aliases: ["stück", "stueck", "stk", "stk."],
    dimension: "count:piece",
    id: "stück",
    plural: "Stück",
    singular: "Stück",
  },
  {
    aliases: ["becher"],
    dimension: "count:beaker",
    id: "becher",
    plural: "Becher",
    singular: "Becher",
  },
  {
    aliases: ["dose", "dosen", "can", "cans"],
    dimension: "count:can",
    id: "dose",
    plural: "Dosen",
    singular: "Dose",
  },
  {
    aliases: ["flasche", "flaschen", "bottle", "bottles"],
    dimension: "count:bottle",
    id: "flasche",
    plural: "Flaschen",
    singular: "Flasche",
  },
  {
    aliases: ["glas", "gläser", "glaeser", "jar", "jars"],
    dimension: "count:jar",
    id: "glas",
    plural: "Gläser",
    singular: "Glas",
  },
  {
    aliases: [
      "packung",
      "packungen",
      "päckchen",
      "paeckchen",
      "pck",
      "pck.",
      "pkg",
      "pkg.",
      "pack",
      "packs",
      "packet",
      "packets",
      "package",
      "packages",
    ],
    dimension: "count:package",
    id: "packung",
    plural: "Packungen",
    singular: "Packung",
  },
  {
    aliases: ["tasse", "tassen", "cup", "cups"],
    dimension: "count:cup",
    id: "tasse",
    plural: "Tassen",
    singular: "Tasse",
  },
  {
    aliases: ["zehe", "zehen", "knoblauchzehe", "knoblauchzehen", "clove", "cloves"],
    dimension: "count:clove",
    id: "zehe",
    plural: "Zehen",
    singular: "Zehe",
  },
  {
    aliases: ["zweig", "zweige", "sprig", "sprigs"],
    dimension: "count:sprig",
    id: "zweig",
    plural: "Zweige",
    singular: "Zweig",
  },
  {
    aliases: ["bund", "bunch", "bunches"],
    dimension: "count:bunch",
    id: "bund",
    plural: "Bund",
    singular: "Bund",
  },
  {
    aliases: ["stange", "stangen"],
    dimension: "count:stalk",
    id: "stange",
    plural: "Stangen",
    singular: "Stange",
  },
  {
    aliases: ["prise", "prisen", "pinch", "pinches"],
    dimension: "approximate:pinch",
    id: "prise",
    plural: "Prisen",
    singular: "Prise",
  },
  {
    aliases: ["msp", "msp.", "messerspitze"],
    dimension: "approximate:knife-tip",
    id: "msp",
    plural: "Msp",
    singular: "Msp",
  },
  {
    aliases: ["handvoll", "handful", "handfuls"],
    dimension: "approximate:handful",
    id: "handvoll",
    plural: "Handvoll",
    singular: "Handvoll",
  },
];

const unitsByAlias = new Map<string, UnitDefinition>();

for (const definition of unitDefinitions) {
  for (const alias of [
    definition.id,
    definition.singular,
    definition.plural,
    ...definition.aliases,
  ]) {
    unitsByAlias.set(toComparableUnit(alias), definition);
  }
}

export function findUnitDefinition(rawUnit: string): UnitDefinition | undefined {
  const comparable = toComparableUnit(rawUnit);
  const directMatch = unitsByAlias.get(comparable);
  if (directMatch) {
    return directMatch;
  }

  for (const candidate of editorialSingularCandidates(comparable)) {
    const match = unitsByAlias.get(candidate);
    if (match) {
      return match;
    }
  }

  return undefined;
}

export function formatUnit(unit: string, amount: string): string {
  const definition = findUnitDefinition(unit);
  if (!definition) {
    return unit;
  }
  return isExactlyOne(amount) ? definition.singular : definition.plural;
}

export function toComparableUnit(rawUnit: string): string {
  return rawUnit.trim().normalize("NFC").replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
}

function editorialSingularCandidates(unit: string): ReadonlyArray<string> {
  const candidates = new Set<string>();
  if (/\([a-zäöüß]+\)$/u.test(unit)) {
    candidates.add(unit.replace(/\([a-zäöüß]+\)$/u, ""));
  }
  if (/\/[a-zäöüß]+$/u.test(unit)) {
    candidates.add(unit.replace(/\/[a-zäöüß]+$/u, ""));
  }
  return [...candidates];
}

function isExactlyOne(amount: string): boolean {
  const comparable = amount.trim().replace(",", ".");
  return /^0*1(?:\.0+)?$/.test(comparable);
}
