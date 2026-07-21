import OpenAI, { APIError } from "openai";
import type { AuthenticatedUser } from "./auth-service.ts";
import type { AppDatabase } from "./database.ts";
import { AppError } from "./errors.ts";
import type { ImageService } from "./image-service.ts";
import type { SettingsService } from "./settings-service.ts";
import { normalizeComparableText } from "./text.ts";

export const recipeModel = "gpt-5.6-terra";
export const recipeAnalysisPrompt = `Analysiere das fotografierte Rezept unabhängig von seiner Ausgangssprache. Extrahiere ausschließlich Zutaten, die eingekauft werden können.

Sprache:
- Gib Titel, Produktnamen und Zusatztexte auf Deutsch aus.
- Verwende kurze, in deutschen Supermärkten übliche Produktnamen. Erhalte relevante Sorten-, Marken- und Zustandsangaben wie "gehackt" oder "ungesüßt" als kurzen Zusatztext.

Mengen und Einheiten:
- Mengen sind positive Dezimalzahlen als String mit Punkt, zum Beispiel "0.5", niemals Brüche.
- Verwende in Deutschland übliche metrische Kücheneinheiten: g, kg, ml, l, Stück, EL, TL sowie bei Bedarf Prise, Bund, Dose oder Packung.
- Rechne imperiale Masse und Flüssigkeitsvolumen metrisch um: oz und lb in g oder kg; fl oz, cup, pint, quart und gallon in ml oder l.
- Rechne tsp in TL und tbsp in EL um. Für feste Zutaten in cup darfst du eine verlässliche, zutatenspezifische Umrechnung in g verwenden; andernfalls rechne cup als Volumen in ml um.
- Runde alltagstauglich und vermeide Scheingenauigkeit. Verändere die Gesamtmenge des Rezepts nicht und erfinde keine Packungsgrößen.

Ordne jede Zutat einem Einkaufsbereich zu. Wenn das Bild kein lesbares Rezept zeigt, setze isRecipe auf false und ingredients auf eine leere Liste.`;

const allowedCategories = new Set([
  "bakery",
  "canned",
  "dairy",
  "drinks",
  "frozen",
  "household",
  "meat",
  "other",
  "pet",
  "produce",
  "spices",
  "staples",
]);

export type RecipeIngredient = Readonly<{
  amount: string | null;
  category: string;
  inPantry: boolean;
  name: string;
  note: string | null;
  unit: string | null;
}>;

export type RecipeAnalysis = Readonly<{
  ingredients: ReadonlyArray<RecipeIngredient>;
  title: string;
}>;

export interface RecipeAnalyzer {
  analyze(apiKey: string, imageDataUrl: string): Promise<unknown>;
}

export class OpenAiRecipeAnalyzer implements RecipeAnalyzer {
  async analyze(apiKey: string, imageDataUrl: string): Promise<unknown> {
    try {
      const client = new OpenAI({ apiKey, maxRetries: 1, timeout: 45_000 });
      const response = await client.responses.create({
        input: [
          {
            content: [
              {
                text: recipeAnalysisPrompt,
                type: "input_text",
              },
              { detail: "high", image_url: imageDataUrl, type: "input_image" },
            ],
            role: "user",
          },
        ],
        max_output_tokens: 3_000,
        model: recipeModel,
        text: {
          format: {
            name: "recipe_ingredients",
            schema: {
              additionalProperties: false,
              properties: {
                ingredients: {
                  items: {
                    additionalProperties: false,
                    properties: {
                      amount: { type: ["string", "null"] },
                      category: {
                        enum: [...allowedCategories],
                        type: "string",
                      },
                      name: { type: "string" },
                      note: { type: ["string", "null"] },
                      unit: { type: ["string", "null"] },
                    },
                    required: ["name", "amount", "unit", "note", "category"],
                    type: "object",
                  },
                  type: "array",
                },
                isRecipe: { type: "boolean" },
                title: { type: "string" },
              },
              required: ["isRecipe", "title", "ingredients"],
              type: "object",
            },
            strict: true,
            type: "json_schema",
          },
          verbosity: "low",
        },
      });
      return JSON.parse(response.output_text) as unknown;
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
        "Die Rezeptanalyse ist momentan nicht erreichbar. Versuche es später erneut.",
      );
    }
  }
}

export class RecipeService {
  private readonly analyzer: RecipeAnalyzer;
  private readonly database: AppDatabase;
  private readonly imageService: ImageService;
  private readonly settingsService: SettingsService;

  constructor(
    database: AppDatabase,
    imageService: ImageService,
    settingsService: SettingsService,
    analyzer: RecipeAnalyzer = new OpenAiRecipeAnalyzer(),
  ) {
    this.database = database;
    this.imageService = imageService;
    this.settingsService = settingsService;
    this.analyzer = analyzer;
  }

  async analyzeRecipe(
    user: AuthenticatedUser,
    input: Buffer,
    contentType: string,
  ): Promise<RecipeAnalysis> {
    const apiKey = this.settingsService.resolveOpenAiApiKey(user);
    const image = await this.imageService.prepareImage(input, contentType);
    const raw = await this.analyzer.analyze(
      apiKey,
      `data:${image.mimeType};base64,${image.buffer.toString("base64")}`,
    );
    const parsed = validateAnalysis(raw);
    const pantryNames = new Set(
      (
        this.database
          .prepare("SELECT normalized_name FROM pantry_items WHERE household_id = ?")
          .all(user.householdId) as Array<{ normalized_name: string }>
      ).map((item) => item.normalized_name),
    );
    return {
      ingredients: parsed.ingredients.map((ingredient) => ({
        ...ingredient,
        inPantry: pantryNames.has(normalizeComparableText(ingredient.name)),
      })),
      title: parsed.title,
    };
  }
}

function validateAnalysis(value: unknown): {
  ingredients: Array<Omit<RecipeIngredient, "inPantry">>;
  title: string;
} {
  if (!isRecord(value) || value.isRecipe !== true) {
    throw new AppError(422, "not_a_recipe", "Auf dem Bild wurde kein lesbares Rezept erkannt.");
  }
  if (typeof value.title !== "string" || !Array.isArray(value.ingredients)) {
    throw invalidModelResponse();
  }
  if (value.ingredients.length < 1 || value.ingredients.length > 100) {
    throw invalidModelResponse();
  }

  const ingredients = value.ingredients.map((ingredient) => {
    if (
      !isRecord(ingredient) ||
      typeof ingredient.name !== "string" ||
      ingredient.name.trim().length < 1 ||
      ingredient.name.length > 120 ||
      (ingredient.amount !== null && typeof ingredient.amount !== "string") ||
      (ingredient.unit !== null && typeof ingredient.unit !== "string") ||
      (ingredient.note !== null && typeof ingredient.note !== "string") ||
      typeof ingredient.category !== "string" ||
      !allowedCategories.has(ingredient.category)
    ) {
      throw invalidModelResponse();
    }
    return {
      amount: ingredient.amount?.trim() || null,
      category: ingredient.category,
      name: ingredient.name.trim(),
      note: ingredient.note?.trim() || null,
      unit: ingredient.unit?.trim() || null,
    };
  });
  return { ingredients, title: value.title.trim() || "Rezept" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidModelResponse(): AppError {
  return new AppError(
    502,
    "invalid_openai_response",
    "Die Rezeptanalyse hat kein verwertbares Ergebnis geliefert.",
  );
}
