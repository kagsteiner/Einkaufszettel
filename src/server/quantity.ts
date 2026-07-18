import { invalidInput } from "./errors.ts";

const unitAliases: Readonly<Record<string, { normalized: string; display: string }>> = {
  "": { normalized: "", display: "" },
  becher: { normalized: "becher", display: "Becher" },
  dose: { normalized: "dose", display: "Dose" },
  dosen: { normalized: "dose", display: "Dose" },
  el: { normalized: "el", display: "EL" },
  essloeffel: { normalized: "el", display: "EL" },
  esslöffel: { normalized: "el", display: "EL" },
  flasche: { normalized: "flasche", display: "Flasche" },
  flaschen: { normalized: "flasche", display: "Flasche" },
  g: { normalized: "g", display: "g" },
  gramm: { normalized: "g", display: "g" },
  kg: { normalized: "kg", display: "kg" },
  kilogramm: { normalized: "kg", display: "kg" },
  l: { normalized: "l", display: "l" },
  liter: { normalized: "l", display: "l" },
  ml: { normalized: "ml", display: "ml" },
  packung: { normalized: "packung", display: "Packung" },
  packungen: { normalized: "packung", display: "Packung" },
  stk: { normalized: "stück", display: "Stück" },
  "stk.": { normalized: "stück", display: "Stück" },
  stück: { normalized: "stück", display: "Stück" },
  stueck: { normalized: "stück", display: "Stück" },
  tasse: { normalized: "tasse", display: "Tasse" },
  tassen: { normalized: "tasse", display: "Tasse" },
  tl: { normalized: "tl", display: "TL" },
  teeloeffel: { normalized: "tl", display: "TL" },
  teelöffel: { normalized: "tl", display: "TL" },
  zehe: { normalized: "zehe", display: "Zehe" },
  zehen: { normalized: "zehe", display: "Zehe" },
};

export type QuantityInput = Readonly<{ amount: unknown; unit?: unknown }>;
export type NormalizedQuantity = Readonly<{
  amount: string;
  normalizedUnit: string;
  unit: string;
}>;

export function normalizeQuantity(input: QuantityInput): NormalizedQuantity {
  const amount = normalizeDecimal(input.amount);
  if (input.unit !== undefined && typeof input.unit !== "string") {
    throw invalidInput("Die Mengeneinheit ist ungültig.");
  }
  const rawUnit = (input.unit || "").trim().normalize("NFC").replace(/\s+/g, " ");
  if (rawUnit.length > 40) {
    throw invalidInput("Die Mengeneinheit ist zu lang.");
  }
  const comparable = rawUnit.toLocaleLowerCase("de-DE");
  const known = unitAliases[comparable];
  return {
    amount,
    normalizedUnit: known?.normalized || comparable,
    unit: known?.display || rawUnit,
  };
}

export function addDecimal(left: string, right: string): string {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const scale = Math.max(leftParts[1]?.length || 0, rightParts[1]?.length || 0);
  const toScaledInteger = (parts: string[]): bigint =>
    BigInt(`${parts[0]}${(parts[1] || "").padEnd(scale, "0")}`);
  const sum = (toScaledInteger(leftParts) + toScaledInteger(rightParts))
    .toString()
    .padStart(scale + 1, "0");
  if (scale === 0) {
    return sum;
  }
  const integer = sum.slice(0, -scale);
  const fraction = sum.slice(-scale).replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer;
}

function normalizeDecimal(value: unknown): string {
  const raw =
    typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  const normalized = raw.replace(",", ".");
  if (!/^\d{1,9}(?:\.\d{1,4})?$/.test(normalized)) {
    throw invalidInput(
      "Die Menge muss eine positive Zahl mit höchstens vier Nachkommastellen sein.",
    );
  }
  const [integer = "0", fraction = ""] = normalized.split(".");
  const canonicalInteger = integer.replace(/^0+(?=\d)/, "");
  const canonicalFraction = fraction.replace(/0+$/, "");
  const canonical = canonicalFraction
    ? `${canonicalInteger}.${canonicalFraction}`
    : canonicalInteger;
  if (canonical === "0") {
    throw invalidInput("Die Menge muss größer als null sein.");
  }
  return canonical;
}
