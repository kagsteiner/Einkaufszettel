import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decryptApiKey,
  encryptApiKey,
  hashPassword,
  verifyPassword,
} from "../src/server/security.ts";

test("passwords use parameterized Argon2id hashes", async () => {
  const hash = await hashPassword("ein langes Testpasswort");

  assert.match(hash, /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  assert.equal(await verifyPassword(hash, "ein langes Testpasswort"), true);
  assert.equal(await verifyPassword(hash, "ein falsches Testpasswort"), false);
});

test("API keys use authenticated encryption bound to the user", () => {
  const masterKey = Buffer.alloc(32, 7);
  const apiKey = "sk-test-this-is-not-a-real-secret-value";
  const envelope = encryptApiKey(apiKey, "user-a", masterKey);

  assert.ok(!envelope.includes(apiKey));
  assert.equal(decryptApiKey(envelope, "user-a", masterKey), apiKey);
  assert.throws(() => decryptApiKey(envelope, "user-b", masterKey));
});
