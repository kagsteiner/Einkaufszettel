export function normalizeComparableText(value: string): string {
  return value.trim().normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
}

export function cleanRequiredText(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} fehlt.`);
  }
  const cleaned = value.trim().normalize("NFC").replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > maximumLength) {
    throw new TypeError(`${label} muss zwischen 1 und ${maximumLength} Zeichen lang sein.`);
  }
  return cleaned;
}
