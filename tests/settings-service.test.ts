import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { AuthService, type SessionCredentials } from "../src/server/auth-service.ts";
import { loadConfig } from "../src/server/config.ts";
import type { AppDatabase } from "../src/server/database.ts";
import { openDatabase } from "../src/server/database.ts";
import { SettingsService } from "../src/server/settings-service.ts";

let database: AppDatabase;
let settings: SettingsService;
let user: SessionCredentials;

before(async () => {
  database = await openDatabase(":memory:");
  const config = loadConfig({
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString("base64"),
    APP_ENV: "test",
    PORT: "3000",
  });
  const auth = new AuthService(database, config);
  settings = new SettingsService(database, config);
  user = await auth.register({
    displayName: "Erin",
    email: "erin@example.com",
    password: "Erin hat ein langes Passwort",
  });
});

after(() => database.close());

test("personal API keys are masked and encrypted at rest", () => {
  const apiKey = "sk-test-this-is-a-fake-personal-key";
  assert.deepEqual(settings.saveOpenAiApiKey(user.user, apiKey), { mask: "••••-key" });
  const stored = database
    .prepare("SELECT openai_key_ciphertext FROM users WHERE id = ?")
    .get(user.user.id) as { openai_key_ciphertext: string };

  assert.ok(!stored.openai_key_ciphertext.includes(apiKey));
  assert.equal(settings.resolveOpenAiApiKey(user.user), apiKey);
  settings.deleteOpenAiApiKey(user.user);
  assert.throws(() => settings.resolveOpenAiApiKey(user.user), /Hinterlege zuerst/);
});
