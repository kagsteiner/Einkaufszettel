import { unicodeProductIcons } from "./product-icons.generated.ts";

const productAliases: Readonly<Record<string, string>> = {
  äpfel: "🍎",
  apfelsaft: "🧃",
  aubergine: "🍆",
  auberginen: "🍆",
  avocados: "🥑",
  bananen: "🍌",
  batterien: "🔋",
  bier: "🍺",
  birnen: "🍐",
  bioeier: "🥚",
  "bio-eier": "🥚",
  blaubeeren: "🫐",
  blumenkohl: "🥦",
  bohnen: "🫘",
  brezen: "🥨",
  brötchen: "🥖",
  champignon: "🍄",
  champignons: "🍄",
  cola: "🥤",
  croissants: "🥐",
  eier: "🥚",
  erbsen: "🫛",
  erdnussbutter: "🥜",
  erdnüsse: "🥜",
  erdbeeren: "🍓",
  fisch: "🐟",
  fischfilet: "🐟",
  fladenbrot: "🫓",
  fleisch: "🥩",
  freilandeier: "🥚",
  gemüsepaprika: "🫑",
  getränk: "🥤",
  getränke: "🥤",
  gurken: "🥒",
  haferflocken: "🌾",
  hafermilch: "🥛",
  hackfleisch: "🥩",
  hähnchen: "🍗",
  hähnchenbrust: "🍗",
  handseife: "🧼",
  honig: "🍯",
  hundefutter: "🐕",
  hühnereier: "🥚",
  joghurt: "🥛",
  kartoffeln: "🥔",
  katzenfutter: "🐈",
  käse: "🧀",
  käsekuchen: "🍰",
  kaffeebohnen: "☕",
  karotten: "🥕",
  ketchup: "🍅",
  klopapier: "🧻",
  knoblauch: "🧄",
  knoblauchzehen: "🧄",
  limetten: "🍋‍🟩",
  mangos: "🥭",
  mandarinen: "🍊",
  mehl: "🌾",
  melonen: "🍈",
  milch: "🥛",
  mineralwasser: "💧",
  möhren: "🥕",
  mozzarella: "🧀",
  müsli: "🥣",
  nudeln: "🍝",
  obstsaft: "🧃",
  oliven: "🫒",
  olivenöl: "🫒",
  orangen: "🍊",
  orangensaft: "🧃",
  parmesan: "🧀",
  paprika: "🫑",
  paprikapulver: "🌶️",
  pasta: "🍝",
  pfirsiche: "🍑",
  pilze: "🍄",
  pizza: "🍕",
  pommes: "🍟",
  putenbrust: "🍗",
  rapsöl: "🫒",
  reis: "🍚",
  salat: "🥬",
  salz: "🧂",
  saft: "🧃",
  schokolade: "🍫",
  sekt: "🥂",
  seife: "🧼",
  shampoo: "🧴",
  sonnenblumenöl: "🫒",
  speiseöl: "🫒",
  spinat: "🥬",
  spülmittel: "🧴",
  tee: "🫖",
  toilettenpapier: "🧻",
  tomaten: "🍅",
  torten: "🎂",
  trauben: "🍇",
  vollmilch: "🥛",
  waschmittel: "🧺",
  wasser: "💧",
  wassermelonen: "🍉",
  wein: "🍷",
  weintrauben: "🍇",
  wurst: "🌭",
  würstchen: "🌭",
  zahnbürste: "🪥",
  zahnbürsten: "🪥",
  zahnpasta: "🦷",
  zitronen: "🍋",
  zucker: "🍬",
  zwiebeln: "🧅",
};

const compoundAliases = Object.entries(productAliases)
  .filter(([name]) => name.length >= 4 && !name.includes("-"))
  .sort(([left], [right]) => right.length - left.length);

export function productIcon(name: string): string | null {
  const normalized = normalizeProductName(name);
  const exact = productAliases[normalized] || unicodeProductIcons[normalized];
  if (exact) {
    return exact;
  }

  const wordMatches = distinctIcons(
    normalized
      .split(/[^\p{L}\p{N}]+/u)
      .map((word) => productAliases[word] || unicodeProductIcons[word])
      .filter((icon): icon is string => Boolean(icon)),
  );
  if (wordMatches.length === 1) {
    return wordMatches[0] || null;
  }

  const compoundMatches = distinctIcons(
    compoundAliases
      .filter(([alias]) => normalized.startsWith(alias) || normalized.endsWith(alias))
      .map(([, icon]) => icon),
  );
  return compoundMatches.length === 1 ? compoundMatches[0] || null : null;
}

function normalizeProductName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
}

function distinctIcons(icons: ReadonlyArray<string>): string[] {
  return [...new Set(icons)];
}
