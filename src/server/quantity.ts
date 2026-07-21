import { findUnitDefinition, toComparableUnit } from "../shared/units.ts";
import { invalidInput } from "./errors.ts";

export type QuantityInput = Readonly<{ amount: unknown; unit?: unknown }>;
export type NormalizedQuantity = Readonly<{
  amount: string;
  normalizedUnit: string;
  unit: string;
}>;

export function normalizeQuantity(input: QuantityInput): NormalizedQuantity {
  const amount = normalizeAmount(input.amount);
  if (input.unit !== undefined && typeof input.unit !== "string") {
    throw invalidInput("Die Mengeneinheit ist ungültig.");
  }
  const rawUnit = (input.unit || "").trim().normalize("NFC").replace(/\s+/g, " ");
  if (rawUnit.length > 40) {
    throw invalidInput("Die Mengeneinheit ist zu lang.");
  }
  const comparable = toComparableUnit(rawUnit);
  const known = findUnitDefinition(comparable);
  return {
    amount,
    normalizedUnit: known?.id || comparable,
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

function normalizeAmount(value: unknown): string {
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
    return upper;
  }

  return normalizeDecimal(raw);
}

function normalizeDecimal(raw: string | undefined): string {
  const normalized = (raw || "").replace(",", ".");
  if (!/^\d{1,9}(?:\.\d{1,4})?$/.test(normalized)) {
    throw invalidInput(
      "Die Menge muss eine positive Zahl oder ein Bereich mit höchstens vier Nachkommastellen sein.",
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
