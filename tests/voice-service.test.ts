import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { AuthService, type SessionCredentials } from "../src/server/auth-service.ts";
import { loadConfig } from "../src/server/config.ts";
import type { AppDatabase } from "../src/server/database.ts";
import { openDatabase } from "../src/server/database.ts";
import { SettingsService } from "../src/server/settings-service.ts";
import { ShoppingService } from "../src/server/shopping-service.ts";
import {
  type VoiceAnalyzer,
  VoiceService,
  voiceExtractionModel,
  voiceExtractionPrompt,
  voiceTranscriptionModel,
} from "../src/server/voice-service.ts";

let database: AppDatabase;
let owner: SessionCredentials;
let settings: SettingsService;

before(async () => {
  const config = loadConfig({
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 23).toString("base64"),
    APP_ENV: "test",
    PORT: "3000",
  });
  database = await openDatabase(":memory:");
  const auth = new AuthService(database, config);
  owner = await auth.register({
    displayName: "Voice Test",
    email: "voice@example.com",
    password: "Voice hat ein langes Passwort",
  });
  settings = new SettingsService(database, config);
});

after(() => database.close());

test("voice analysis uses the personal key and household product vocabulary", async () => {
  settings.saveOpenAiApiKey(owner.user, "sk-test-this-key-is-only-a-fixture");
  const shopping = new ShoppingService(database);
  const list = shopping.createList(owner.user, "Supermarkt");
  shopping.addItem(owner.user, list.id, { name: "Hafermilch" });
  shopping.addPantryItem(owner.user, "Salz");
  let receivedKey = "";
  let receivedType = "";
  let receivedVocabulary: ReadonlyArray<string> = [];
  const analyzer: VoiceAnalyzer = {
    async analyze(apiKey, input, contentType, vocabulary) {
      receivedKey = apiKey;
      receivedType = contentType;
      receivedVocabulary = vocabulary;
      assert.deepEqual(input, Buffer.from("audio"));
      return {
        items: [{ amount: "2", name: "Milch", note: "Bio", unit: "l" }],
        transcript: "Zwei Liter Biomilch.",
      };
    },
  };
  const service = new VoiceService(database, settings, analyzer);
  const result = await service.analyzeVoice(owner.user, Buffer.from("audio"), "audio/webm");

  assert.equal(receivedKey, "sk-test-this-key-is-only-a-fixture");
  assert.equal(receivedType, "audio/webm");
  assert.ok(receivedVocabulary.includes("Hafermilch"));
  assert.ok(receivedVocabulary.includes("Salz"));
  assert.deepEqual(result, {
    items: [{ amount: "2", name: "Milch", note: "Bio", unit: "l" }],
    transcript: "Zwei Liter Biomilch.",
  });
});

test("voice analysis rejects unsupported and malformed results", async () => {
  settings.saveOpenAiApiKey(owner.user, "sk-test-this-key-is-only-a-fixture");
  const analyzer: VoiceAnalyzer = {
    async analyze() {
      return { items: [{ amount: null, name: "", note: null, unit: null }], transcript: "x" };
    },
  };
  const service = new VoiceService(database, settings, analyzer);

  await assert.rejects(
    service.analyzeVoice(owner.user, Buffer.from("audio"), "text/plain"),
    /Audioformat/,
  );
  await assert.rejects(
    service.analyzeVoice(owner.user, Buffer.from("audio"), "audio/webm"),
    /kein verwertbares Ergebnis/,
  );
});

test("voice models and extraction rules match the shopping-dictation use case", () => {
  assert.equal(voiceTranscriptionModel, "gpt-transcribe");
  assert.equal(voiceExtractionModel, "gpt-5.6-luna");
  assert.match(voiceExtractionPrompt, /Gespräche mit anderen Personen/);
  assert.match(voiceExtractionPrompt, /nicht benötigte Produkte nicht auf/);
  assert.match(voiceExtractionPrompt, /Selbstkorrekturen/);
  assert.match(voiceExtractionPrompt, /letzte Aussage/);
  assert.match(voiceExtractionPrompt, /Erfinde keine Produkte/);
});
