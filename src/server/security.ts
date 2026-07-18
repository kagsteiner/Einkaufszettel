import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import argon2 from "argon2";
import { invalidInput } from "./errors.ts";

const passwordParameters = {
  hashLength: 32,
  memoryCost: 65_536,
  parallelism: 1,
  timeCost: 3,
  type: argon2.argon2id,
} as const;

export function normalizeEmail(value: unknown): { display: string; normalized: string } {
  if (typeof value !== "string") {
    throw invalidInput("Bitte gib eine gültige E-Mail-Adresse ein.");
  }
  const display = value.trim().normalize("NFKC");
  const normalized = display.toLowerCase();
  const at = normalized.indexOf("@");
  if (
    display.length < 3 ||
    display.length > 320 ||
    at < 1 ||
    at !== normalized.lastIndexOf("@") ||
    at === normalized.length - 1 ||
    /\s/.test(display)
  ) {
    throw invalidInput("Bitte gib eine gültige E-Mail-Adresse ein.");
  }
  return { display, normalized };
}

export function normalizeDisplayName(value: unknown): string {
  if (typeof value !== "string") {
    throw invalidInput("Bitte gib deinen Namen ein.");
  }
  const normalized = value.trim().normalize("NFC").replace(/\s+/g, " ");
  if (normalized.length < 1 || normalized.length > 80) {
    throw invalidInput("Der Name muss zwischen 1 und 80 Zeichen lang sein.");
  }
  return normalized;
}

export function validatePassword(value: unknown): string {
  if (typeof value !== "string") {
    throw invalidInput("Bitte gib ein Passwort ein.");
  }
  const byteLength = Buffer.byteLength(value, "utf8");
  if (value.length < 12) {
    throw invalidInput("Das Passwort muss mindestens 12 Zeichen lang sein.");
  }
  if (byteLength > 1_024) {
    throw invalidInput("Das Passwort ist zu lang.");
  }
  return value;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, passwordParameters);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export function tokenMatches(expectedHash: string, token: string): boolean {
  const actual = Buffer.from(hashToken(token), "utf8");
  const expected = Buffer.from(expectedHash, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function encryptApiKey(apiKey: string, userId: string, masterKey: Buffer | null): string {
  if (!masterKey) {
    throw new Error("Zum Speichern persönlicher API Keys fehlt APP_ENCRYPTION_KEY.");
  }
  if (apiKey.length < 20 || apiKey.length > 512 || /\s/.test(apiKey)) {
    throw invalidInput("Der OpenAI API Key hat kein gültiges Format.");
  }

  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(`einkaufszettel:openai-key:v1:${userId}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const authenticationTag = cipher.getAuthTag();

  return [
    "v1",
    nonce.toString("base64url"),
    ciphertext.toString("base64url"),
    authenticationTag.toString("base64url"),
  ].join(":");
}

export function decryptApiKey(envelope: string, userId: string, masterKey: Buffer | null): string {
  if (!masterKey) {
    throw new Error("Zum Entschlüsseln persönlicher API Keys fehlt APP_ENCRYPTION_KEY.");
  }
  const [version, encodedNonce, encodedCiphertext, encodedTag, ...unexpected] = envelope.split(":");
  if (
    version !== "v1" ||
    !encodedNonce ||
    !encodedCiphertext ||
    !encodedTag ||
    unexpected.length > 0
  ) {
    throw new Error("Unbekanntes Format des verschlüsselten API Keys.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    masterKey,
    Buffer.from(encodedNonce, "base64url"),
    {
      authTagLength: 16,
    },
  );
  decipher.setAAD(Buffer.from(`einkaufszettel:openai-key:v1:${userId}`, "utf8"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
