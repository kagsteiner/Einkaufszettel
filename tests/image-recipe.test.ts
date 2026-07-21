import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import sharp from "sharp";
import { AuthService, type SessionCredentials } from "../src/server/auth-service.ts";
import { loadConfig } from "../src/server/config.ts";
import type { AppDatabase } from "../src/server/database.ts";
import { openDatabase } from "../src/server/database.ts";
import { ImageService } from "../src/server/image-service.ts";
import {
  type RecipeAnalyzer,
  RecipeService,
  recipeAnalysisPrompt,
  recipeModel,
} from "../src/server/recipe-service.ts";
import { SettingsService } from "../src/server/settings-service.ts";
import { ShoppingService } from "../src/server/shopping-service.ts";

let database: AppDatabase;
let imageService: ImageService;
let owner: SessionCredentials;
let outsider: SessionCredentials;
let settings: SettingsService;
let shopping: ShoppingService;
let temporaryDirectory: string;
let testImage: Buffer;

before(async () => {
  temporaryDirectory = await mkdtemp(resolve(tmpdir(), "einkaufszettel-images-"));
  const config = loadConfig({
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 13).toString("base64"),
    APP_ENV: "test",
    PORT: "3000",
    UPLOAD_DIRECTORY: temporaryDirectory,
  });
  database = await openDatabase(":memory:");
  const auth = new AuthService(database, config);
  owner = await auth.register({
    displayName: "Foto Test",
    email: "foto@example.com",
    password: "Foto hat ein langes Passwort",
  });
  outsider = await auth.register({
    displayName: "Außen",
    email: "aussen@example.com",
    password: "Außen hat ein langes Passwort",
  });
  imageService = new ImageService(database, config);
  settings = new SettingsService(database, config);
  shopping = new ShoppingService(database);
  testImage = await sharp({
    create: { background: "#d5664e", channels: 3, height: 80, width: 120 },
  })
    .jpeg()
    .toBuffer();
});

after(async () => {
  database.close();
  await rm(temporaryDirectory, { force: true, recursive: true });
});

test("uploaded images are re-encoded without metadata and household-protected", async () => {
  const stored = await imageService.storeImage(owner.user, testImage, "image/jpeg");
  const image = await imageService.readImage(owner.user, stored.id);
  const metadata = await sharp(image.buffer).metadata();

  assert.equal(image.mimeType, "image/webp");
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.exif, undefined);
  await assert.rejects(imageService.readImage(outsider.user, stored.id), /nicht gefunden/);
});

test("recipe analysis uses the personal key and preselects no pantry products", async () => {
  settings.saveOpenAiApiKey(owner.user, "sk-test-this-key-is-only-a-fixture");
  shopping.addPantryItem(owner.user, "Salz");
  let receivedKey = "";
  let receivedImage = "";
  const analyzer: RecipeAnalyzer = {
    async analyze(apiKey, imageDataUrl) {
      receivedKey = apiKey;
      receivedImage = imageDataUrl;
      return {
        ingredients: [
          { amount: "1", category: "spices", name: "Salz", note: null, unit: "TL" },
          { amount: "4", category: "produce", name: "Äpfel", note: null, unit: "Stück" },
        ],
        isRecipe: true,
        title: "Apfelgericht",
      };
    },
  };
  const recipe = new RecipeService(database, imageService, settings, analyzer);
  const result = await recipe.analyzeRecipe(owner.user, testImage, "image/jpeg");

  assert.equal(recipeModel, "gpt-5.6-terra");
  assert.equal(receivedKey, "sk-test-this-key-is-only-a-fixture");
  assert.match(receivedImage, /^data:image\/webp;base64,/);
  assert.deepEqual(
    result.ingredients.map(({ inPantry, name }) => ({ inPantry, name })),
    [
      { inPantry: true, name: "Salz" },
      { inPantry: false, name: "Äpfel" },
    ],
  );
});

test("the recipe prompt translates foreign recipes and converts imperial units", () => {
  assert.match(recipeAnalysisPrompt, /Ausgangssprache/);
  assert.match(recipeAnalysisPrompt, /Titel, Produktnamen und Zusatztexte auf Deutsch/);
  assert.match(recipeAnalysisPrompt, /oz und lb in g oder kg/);
  assert.match(recipeAnalysisPrompt, /fl oz, cup, pint, quart und gallon in ml oder l/);
  assert.match(recipeAnalysisPrompt, /tsp in TL und tbsp in EL/);
  assert.match(recipeAnalysisPrompt, /vermeide Scheingenauigkeit/);
  assert.match(recipeAnalysisPrompt, /erfinde keine Packungsgrößen/);
  assert.match(recipeAnalysisPrompt, /Mengenbereich immer dessen Obergrenze/);
  assert.match(recipeAnalysisPrompt, /"einige", "etwas" und "nach Bedarf"/);
  assert.match(recipeAnalysisPrompt, /Größen- und Zustandsangaben.*gehören in note/);
});
