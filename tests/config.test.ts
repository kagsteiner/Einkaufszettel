import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/server/config.ts";

test("production ignores the local OpenAI fallback", () => {
  const encryptionKey = Buffer.alloc(32, 9).toString("base64");
  const config = loadConfig({
    APP_ENCRYPTION_KEY: encryptionKey,
    APP_ENV: "production",
    APP_ORIGIN: "https://zettel.example",
    OPENAI_API_KEY: "must-not-be-used",
    PORT: "8080",
  });

  assert.equal(config.appEnvironment, "production");
  assert.equal(config.developmentOpenAiApiKey, null);
  assert.equal(config.port, 8080);
});

test("development accepts an exact 32-byte encryption key", () => {
  const encryptionKey = Buffer.alloc(32, 42);
  const config = loadConfig({ APP_ENCRYPTION_KEY: encryptionKey.toString("base64") });

  assert.deepEqual(config.encryptionKey, encryptionKey);
});

test("a base path supports deployment below a reverse-proxy subdirectory", () => {
  assert.equal(loadConfig({ APP_BASE_PATH: "/zettel" }).basePath, "/zettel");
  assert.throws(() => loadConfig({ APP_BASE_PATH: "/zettel/" }), /APP_BASE_PATH/);
});

test("invalid configuration fails before the server starts", () => {
  assert.throws(() => loadConfig({ PORT: "0" }), /PORT/);
  assert.throws(() => loadConfig({ APP_ENV: "staging" }), /APP_ENV/);
  assert.throws(() => loadConfig({ APP_ENCRYPTION_KEY: "too-short" }), /APP_ENCRYPTION_KEY/);
  assert.throws(() => loadConfig({ APP_ENV: "production" }), /APP_ORIGIN/);
});
