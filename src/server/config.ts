import { resolve } from "node:path";

export type AppEnvironment = "development" | "production" | "test";

export type AppConfig = Readonly<{
  appEnvironment: AppEnvironment;
  databasePath: string;
  developmentOpenAiApiKey: string | null;
  encryptionKey: Buffer | null;
  origin: string | null;
  port: number;
  publicDirectory: string;
}>;

const appEnvironments = new Set<AppEnvironment>(["development", "production", "test"]);

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawEnvironment = environment.APP_ENV?.trim() || "development";
  if (!appEnvironments.has(rawEnvironment as AppEnvironment)) {
    throw new Error("APP_ENV muss development, production oder test sein.");
  }

  const port = Number(environment.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT muss eine ganze Zahl zwischen 1 und 65535 sein.");
  }

  const encryptionKey = parseEncryptionKey(environment.APP_ENCRYPTION_KEY);
  const appEnvironment = rawEnvironment as AppEnvironment;

  return {
    appEnvironment,
    databasePath: resolve(environment.DATABASE_PATH?.trim() || "data/einkaufszettel.db"),
    developmentOpenAiApiKey:
      appEnvironment === "development" ? environment.OPENAI_API_KEY?.trim() || null : null,
    encryptionKey,
    origin: environment.APP_ORIGIN?.trim().replace(/\/$/, "") || null,
    port,
    publicDirectory: resolve(environment.PUBLIC_DIRECTORY?.trim() || "dist/public"),
  };
}

function parseEncryptionKey(value: string | undefined): Buffer | null {
  if (!value?.trim()) {
    return null;
  }

  const decoded = Buffer.from(value.trim(), "base64");
  if (
    decoded.length !== 32 ||
    decoded.toString("base64").replace(/=+$/, "") !== value.trim().replace(/=+$/, "")
  ) {
    throw new Error(
      "APP_ENCRYPTION_KEY muss ein gültiger Base64-kodierter 32-Byte-Schlüssel sein.",
    );
  }
  return decoded;
}
