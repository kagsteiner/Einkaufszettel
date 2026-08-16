import OpenAI, { APIError, toFile } from "openai";
import type { AuthenticatedUser } from "./auth-service.ts";
import type { AppDatabase } from "./database.ts";
import { AppError } from "./errors.ts";
import type { SettingsService } from "./settings-service.ts";

export const maximumVoiceBytes = 12 * 1_024 * 1_024;
export const voiceTranscriptionModel = "gpt-transcribe";
export const voiceExtractionModel = "gpt-5.6-luna";

export const voiceExtractionPrompt = `Du wandelst ein gesprochenes Einkaufsdiktat in eine strukturierte Einkaufsliste um.

- Extrahiere nur Produkte, die fehlen oder gekauft werden sollen.
- Ignoriere Gespräche mit anderen Personen und alles, was keine Einkaufsanweisung ist.
- Nimm ausdrücklich vorhandene oder nicht benötigte Produkte nicht auf.
- Berücksichtige Selbstkorrekturen und verwende bei Widersprüchen die letzte Aussage.
- Verwende kurze, in deutschen Supermärkten übliche Produktnamen.
- Konkrete Mengen sind positive Dezimalzahlen als String mit Punkt. Mengenbereiche werden nicht erfunden.
- Schreibe die Einheit getrennt von der Menge. Wenn keine Menge genannt wurde, sind amount und unit null.
- Kurze Angaben wie "Bio", "laktosefrei" oder "die große Packung" gehören in note.
- Fasse dasselbe Produkt innerhalb des Diktats zu einem Eintrag zusammen, sofern Menge und Einheit verlässlich kombinierbar sind.
- Erfinde keine Produkte, Mengen oder Eigenschaften.`;

export type VoiceDraftItem = Readonly<{
  amount: string | null;
  name: string;
  note: string | null;
  unit: string | null;
}>;

export type VoiceAnalysis = Readonly<{
  items: ReadonlyArray<VoiceDraftItem>;
  transcript: string;
}>;

export interface VoiceAnalyzer {
  analyze(
    apiKey: string,
    input: Buffer,
    contentType: string,
    vocabulary: ReadonlyArray<string>,
  ): Promise<unknown>;
}

export class OpenAiVoiceAnalyzer implements VoiceAnalyzer {
  async analyze(
    apiKey: string,
    input: Buffer,
    contentType: string,
    vocabulary: ReadonlyArray<string>,
  ): Promise<unknown> {
    try {
      const client = new OpenAI({ apiKey, maxRetries: 1, timeout: 45_000 });
      const extension = audioExtension(contentType);
      const file = await toFile(input, `einkaufsdiktat.${extension}`, { type: contentType });
      const context = vocabulary.slice(0, 150).join(", ").slice(0, 4_000);
      const transcription = await client.audio.transcriptions.create({
        file,
        language: "de",
        model: voiceTranscriptionModel,
        prompt: context
          ? `Deutsches Einkaufsdiktat. Mögliche Produktnamen aus diesem Haushalt: ${context}`
          : "Deutsches Einkaufsdiktat mit Lebensmitteln und Haushaltsprodukten.",
      });
      const transcript = transcription.text.trim();
      if (!transcript) {
        return { items: [], transcript: "" };
      }
      const response = await client.responses.create({
        input: `${voiceExtractionPrompt}\n\nDiktat:\n${transcript}`,
        max_output_tokens: 2_000,
        model: voiceExtractionModel,
        reasoning: { effort: "none" },
        text: {
          format: {
            name: "voice_shopping_items",
            schema: {
              additionalProperties: false,
              properties: {
                items: {
                  items: {
                    additionalProperties: false,
                    properties: {
                      amount: { type: ["string", "null"] },
                      name: { type: "string" },
                      note: { type: ["string", "null"] },
                      unit: { type: ["string", "null"] },
                    },
                    required: ["name", "amount", "unit", "note"],
                    type: "object",
                  },
                  type: "array",
                },
              },
              required: ["items"],
              type: "object",
            },
            strict: true,
            type: "json_schema",
          },
          verbosity: "low",
        },
      });
      const extracted = JSON.parse(response.output_text) as unknown;
      return { ...(isRecord(extracted) ? extracted : {}), transcript };
    } catch (error) {
      if (error instanceof APIError) {
        if (error.status === 401 || error.status === 403) {
          throw new AppError(
            422,
            "openai_key_invalid",
            "Der OpenAI API Key wurde abgelehnt. Prüfe ihn in den Einstellungen.",
          );
        }
        if (error.status === 429) {
          throw new AppError(
            429,
            "openai_quota_exceeded",
            "OpenAI hat das Kontingent oder das Aufruflimit erreicht.",
          );
        }
      }
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        502,
        "openai_unavailable",
        "Die Spracherkennung ist momentan nicht erreichbar. Versuche es später erneut.",
      );
    }
  }
}

export class VoiceService {
  private readonly analyzer: VoiceAnalyzer;
  private readonly database: AppDatabase;
  private readonly settingsService: SettingsService;

  constructor(
    database: AppDatabase,
    settingsService: SettingsService,
    analyzer: VoiceAnalyzer = new OpenAiVoiceAnalyzer(),
  ) {
    this.database = database;
    this.settingsService = settingsService;
    this.analyzer = analyzer;
  }

  async analyzeVoice(
    user: AuthenticatedUser,
    input: Buffer,
    contentType: string,
  ): Promise<VoiceAnalysis> {
    if (!allowedAudioTypes.has(contentType)) {
      throw new AppError(
        415,
        "unsupported_media_type",
        "Dieses Audioformat wird nicht unterstützt.",
      );
    }
    if (input.length < 1) {
      throw new AppError(400, "invalid_audio", "Die Aufnahme ist leer.");
    }
    if (input.length > maximumVoiceBytes) {
      throw new AppError(413, "body_too_large", "Die Aufnahme ist zu groß.");
    }
    const apiKey = this.settingsService.resolveOpenAiApiKey(user);
    const vocabulary = (
      this.database
        .prepare(
          `SELECT i.name AS name FROM items i
           JOIN shopping_lists l ON l.id = i.list_id
           WHERE l.household_id = ?
           UNION SELECT name FROM pantry_items WHERE household_id = ?`,
        )
        .all(user.householdId, user.householdId) as Array<{ name: string }>
    ).map(({ name }) => name);
    return validateAnalysis(await this.analyzer.analyze(apiKey, input, contentType, vocabulary));
  }
}

const allowedAudioTypes = new Set([
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
  "audio/x-wav",
  "video/mp4",
  "video/webm",
]);

function audioExtension(contentType: string): string {
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("mpeg")) return "mp3";
  if (contentType.includes("wav")) return "wav";
  return "m4a";
}

function validateAnalysis(value: unknown): VoiceAnalysis {
  if (!isRecord(value) || typeof value.transcript !== "string" || !Array.isArray(value.items)) {
    throw invalidModelResponse();
  }
  if (value.transcript.length > 20_000 || value.items.length > 100) {
    throw invalidModelResponse();
  }
  const items = value.items.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.name !== "string" ||
      item.name.trim().length < 1 ||
      item.name.length > 120 ||
      (item.amount !== null && typeof item.amount !== "string") ||
      (item.unit !== null && typeof item.unit !== "string") ||
      (item.note !== null && typeof item.note !== "string") ||
      (typeof item.amount === "string" && item.amount.length > 40) ||
      (typeof item.unit === "string" && item.unit.length > 40) ||
      (typeof item.note === "string" && item.note.length > 500)
    ) {
      throw invalidModelResponse();
    }
    return {
      amount: item.amount?.trim() || null,
      name: item.name.trim().normalize("NFC"),
      note: item.note?.trim().normalize("NFC") || null,
      unit: item.unit?.trim().normalize("NFC") || null,
    };
  });
  return { items, transcript: value.transcript.trim() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidModelResponse(): AppError {
  return new AppError(
    502,
    "invalid_openai_response",
    "Die Spracherkennung hat kein verwertbares Ergebnis geliefert.",
  );
}
