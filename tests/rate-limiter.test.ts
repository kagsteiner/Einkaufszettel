import assert from "node:assert/strict";
import { test } from "node:test";
import { RateLimiter } from "../src/server/rate-limiter.ts";

test("sensitive operation limits reject excess attempts per key", () => {
  const limiter = new RateLimiter();
  limiter.consume("login:one", 2, 60_000);
  limiter.consume("login:one", 2, 60_000);

  assert.throws(() => limiter.consume("login:one", 2, 60_000), /Zu viele Anfragen/);
  assert.doesNotThrow(() => limiter.consume("login:another", 2, 60_000));
});
