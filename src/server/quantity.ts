import { findUnitDefinition, toComparableUnit } from "../shared/units.ts";
import { invalidInput } from "./errors.ts";

export type QuantityInput = Readonly<{ amount: unknown; unit?: unknown }>;
export type NormalizedQuantity = Readonly<{
  amount: string;
  normalizedUnit: string;
  unit: string;
}>;

export function normalizeQuantity(input: QuantityInput): NormalizedQuantity {
  const normalizedAmount = normalizeAmount(input.amount);
  if (input.unit !== undefined && input.unit !== null && typeof input.unit !== "string") {
    throw invalidInput("Die Mengeneinheit ist ungültig.");
  }
  const rawUnit = (input.unit || "").trim().normalize("NFC").replace(/\s+/g, " ");
  if (rawUnit.length > 40) {
    throw invalidInput("Die Mengeneinheit ist zu lang.");
  }
  const comparable = toComparableUnit(rawUnit);
  const known = findUnitDefinition(comparable);
  const normalizedUnit = known?.id || comparable;
  return {
    amount: normalizedAmount.amount,
    normalizedUnit:
      normalizedAmount.kind === "qualitative" ? `qualitative:${normalizedUnit}` : normalizedUnit,
    unit: known?.singular || rawUnit,
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

export function combineAmounts(left: string, right: string): string {
  if (isDecimal(left) && isDecimal(right)) {
    return addDecimal(left, right);
  }
  const qualitative = normalizeQualitativeAmount(`${left} + ${right}`);
  if (qualitative) {
    return qualitative;
  }
  throw invalidInput("Diese Mengen lassen sich nicht verlässlich addieren.");
}

type NormalizedAmount = Readonly<{
  amount: string;
  kind: "exact" | "qualitative";
}>;

const qualitativeAmounts = [
  { aliases: ["einige"], display: "einige" },
  { aliases: ["etwas"], display: "etwas" },
  {
    aliases: ["nach bedarf", "nach belieben", "n. b.", "n.b.", "n. b", "n.b", "nb"],
    display: "nach Bedarf",
  },
] as const;

const qualitativeAmountsByAlias = new Map<string, (typeof qualitativeAmounts)[number]>();
for (const definition of qualitativeAmounts) {
  for (const alias of [definition.display, ...definition.aliases]) {
    qualitativeAmountsByAlias.set(toComparableUnit(alias), definition);
  }
}

function normalizeAmount(value: unknown): NormalizedAmount {
  const raw =
    typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  const range = raw.match(
    /^(\d{1,9}(?:[.,]\d{1,4})?)\s*(?:-|–|—|bis)\s*(\d{1,9}(?:[.,]\d{1,4})?)$/iu,
  );
  if (range) {
    const lower = normalizeDecimal(range[1]);
    const upper = normalizeDecimal(range[2]);
    if (compareDecimals(lower, upper) > 0) {
      throw invalidInput("Die Untergrenze der Menge darf nicht größer als die Obergrenze sein.");
    }
    return { amount: upper, kind: "exact" };
  }

  const qualitative = normalizeQualitativeAmount(raw);
  if (qualitative) {
    return { amount: qualitative, kind: "qualitative" };
  }

  return { amount: normalizeDecimal(raw), kind: "exact" };
}

function normalizeDecimal(raw: string | undefined): string {
  const normalized = (raw || "").replace(",", ".");
  if (!/^\d{1,9}(?:\.\d{1,4})?$/.test(normalized)) {
    throw invalidInput(
      "Die Menge muss eine positive Zahl, ein Bereich, einige, etwas oder nach Bedarf sein.",
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

function compareDecimals(left: string, right: string): number {
  const toScaledInteger = (value: string): bigint => {
    const [integer = "0", fraction = ""] = value.split(".");
    return BigInt(`${integer}${fraction.padEnd(4, "0")}`);
  };
  const leftInteger = toScaledInteger(left);
  const rightInteger = toScaledInteger(right);
  return leftInteger < rightInteger ? -1 : leftInteger > rightInteger ? 1 : 0;
}

function normalizeQualitativeAmount(raw: string): string | undefined {
  const counts = new Map<(typeof qualitativeAmounts)[number], number>();
  const terms = raw.split("+").map((term) => term.trim());
  if (terms.length === 0 || terms.some((term) => !term)) {
    return undefined;
  }

  for (const term of terms) {
    const match = term.match(/^(?:(\d{1,3})\s*[x×]\s*)?(.+)$/u);
    const definition = match
      ? qualitativeAmountsByAlias.get(toComparableUnit(match[2] || ""))
      : undefined;
    if (!definition) {
      return undefined;
    }
    const count = Number(match?.[1] || "1");
    const total = (counts.get(definition) || 0) + count;
    if (total > 999) {
      throw invalidInput("Eine qualitative Menge wurde zu häufig zusammengeführt.");
    }
    counts.set(definition, total);
  }

  const normalized = qualitativeAmounts
    .filter((definition) => counts.has(definition))
    .map((definition) => {
      const count = counts.get(definition) || 0;
      return count === 1 ? definition.display : `${count} × ${definition.display}`;
    })
    .join(" + ");
  if (normalized.length > 40) {
    throw invalidInput("Die zusammengeführte qualitative Menge ist zu lang.");
  }
  return normalized;
}

function isDecimal(value: string): boolean {
  return /^\d{1,9}(?:\.\d{1,4})?$/.test(value);
}
