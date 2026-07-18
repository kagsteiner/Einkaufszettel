import type { AuthenticatedUser } from "./auth-service.ts";
import type { AppConfig } from "./config.ts";
import type { AppDatabase } from "./database.ts";
import { AppError, invalidInput } from "./errors.ts";
import { decryptApiKey, encryptApiKey, normalizeDisplayName } from "./security.ts";

export class SettingsService {
  private readonly config: AppConfig;
  private readonly database: AppDatabase;

  constructor(database: AppDatabase, config: AppConfig) {
    this.database = database;
    this.config = config;
  }

  updateDisplayName(user: AuthenticatedUser, value: unknown): { displayName: string } {
    const displayName = normalizeDisplayName(value);
    this.database
      .prepare("UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?")
      .run(displayName, new Date().toISOString(), user.id);
    return { displayName };
  }

  saveOpenAiApiKey(user: AuthenticatedUser, value: unknown): { mask: string } {
    if (typeof value !== "string") {
      throw invalidInput("Bitte gib einen OpenAI API Key ein.");
    }
    const apiKey = value.trim();
    const encrypted = encryptApiKey(apiKey, user.id, this.config.encryptionKey);
    const lastFour = apiKey.slice(-4);
    this.database
      .prepare(
        `UPDATE users SET openai_key_ciphertext = ?, openai_key_last_four = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(encrypted, lastFour, new Date().toISOString(), user.id);
    return { mask: `••••${lastFour}` };
  }

  deleteOpenAiApiKey(user: AuthenticatedUser): void {
    this.database
      .prepare(
        `UPDATE users SET openai_key_ciphertext = NULL, openai_key_last_four = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(new Date().toISOString(), user.id);
  }

  resolveOpenAiApiKey(user: AuthenticatedUser): string {
    if (this.config.developmentOpenAiApiKey) {
      return this.config.developmentOpenAiApiKey;
    }
    const row = this.database
      .prepare("SELECT openai_key_ciphertext FROM users WHERE id = ?")
      .get(user.id) as { openai_key_ciphertext: string | null } | undefined;
    if (!row?.openai_key_ciphertext) {
      throw new AppError(
        409,
        "openai_key_required",
        "Hinterlege zuerst deinen persönlichen OpenAI API Key in den Einstellungen.",
      );
    }
    return decryptApiKey(row.openai_key_ciphertext, user.id, this.config.encryptionKey);
  }
}
