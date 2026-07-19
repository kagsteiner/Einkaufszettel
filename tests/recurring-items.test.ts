import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { AuthService, type SessionCredentials } from "../src/server/auth-service.ts";
import { loadConfig } from "../src/server/config.ts";
import type { AppDatabase } from "../src/server/database.ts";
import { openDatabase } from "../src/server/database.ts";
import { ShoppingService } from "../src/server/shopping-service.ts";

const dayMilliseconds = 24 * 60 * 60 * 1_000;
let database: AppDatabase;
let shopping: ShoppingService;
let owner: SessionCredentials;
let outsider: SessionCredentials;
let listId: string;

before(async () => {
  database = await openDatabase(":memory:");
  const auth = new AuthService(database, loadConfig({ APP_ENV: "test", PORT: "3000" }));
  shopping = new ShoppingService(database);
  owner = await auth.register({
    displayName: "Robin",
    email: "robin@example.com",
    password: "Robin hat ein langes Passwort",
  });
  outsider = await auth.register({
    displayName: "Sam",
    email: "sam@example.com",
    password: "Sam hat ein langes Passwort",
  });
  listId = shopping.createList(owner.user, "Wochenmarkt").id;
});

after(() => database.close());

test("only transitions to completed create purchase events", () => {
  const item = shopping.addItem(owner.user, listId, { name: "Bananen" }).item;

  shopping.setCompleted(owner.user, item.id, true);
  shopping.setCompleted(owner.user, item.id, true);
  assert.equal(purchaseEventCount(item.id), 1);

  shopping.setCompleted(owner.user, item.id, false);
  assert.equal(purchaseEventCount(item.id), 1);
  shopping.setCompleted(owner.user, item.id, true);
  assert.equal(purchaseEventCount(item.id), 2);
});

test("due suggestions use the last five purchases and include tomorrow", () => {
  const now = new Date("2026-07-19T12:00:00.000Z");
  const dueItemId = completedItem(
    "Hafermilch",
    now,
    [100, 34, 27, 20, 13, 6],
    [{ amount: "2", unit: "l" }],
  );
  completedItem("Waschmittel", now, [12, 5]);
  completedItem("Einmalkauf", now, [3]);
  const activeItemId = completedItem("Bereits offen", now, [13, 6]);
  database.prepare("UPDATE items SET completed_at = NULL WHERE id = ?").run(activeItemId);

  const suggestions = shopping.getRecurringSuggestions(owner.user, listId, now);

  assert.deepEqual(
    suggestions.map((suggestion) => suggestion.itemId),
    [dueItemId],
  );
  assert.equal(suggestions[0]?.dueAt, "2026-07-20T12:00:00.000Z");
  assert.deepEqual(
    suggestions[0]?.quantities.map(({ amount, unit }) => ({ amount, unit })),
    [{ amount: "2", unit: "l" }],
  );
  assert.throws(
    () => shopping.getRecurringSuggestions(outsider.user, listId, now),
    /nicht gefunden/,
  );
});

test("adding a recurring suggestion keeps its history and accepts edited values", () => {
  const now = new Date();
  const itemId = completedItem("Kaffee", now, [13, 6], [{ amount: "1", unit: "Packung" }]);

  const [item] = shopping.addRecurringItems(owner.user, listId, [
    {
      itemId,
      name: "Espresso",
      quantities: [{ amount: "3", unit: "Packungen" }],
    },
  ]);

  assert.ok(item);
  assert.equal(item.completedAt, null);
  assert.equal(item.name, "Espresso");
  assert.deepEqual(
    item.quantities.map(({ amount, unit }) => ({ amount, unit })),
    [{ amount: "3", unit: "Packung" }],
  );
  assert.equal(purchaseEventCount(itemId), 2);
});

function completedItem(
  name: string,
  now: Date,
  daysAgo: number[],
  quantities: Array<{ amount: string; unit: string }> = [],
): string {
  const item = shopping.addItem(owner.user, listId, { name, quantities }).item;
  const timestamps = daysAgo.map((days) =>
    new Date(now.getTime() - days * dayMilliseconds).toISOString(),
  );
  const insert = database.prepare(
    "INSERT INTO item_purchase_events (id, item_id, purchased_at) VALUES (?, ?, ?)",
  );
  for (const timestamp of timestamps) {
    insert.run(randomUUID(), item.id, timestamp);
  }
  const latestTimestamp = timestamps.at(-1);
  assert.ok(latestTimestamp);
  database
    .prepare("UPDATE items SET completed_at = ?, updated_at = ? WHERE id = ?")
    .run(latestTimestamp, latestTimestamp, item.id);
  return item.id;
}

function purchaseEventCount(itemId: string): number {
  const row = database
    .prepare("SELECT count(*) AS count FROM item_purchase_events WHERE item_id = ?")
    .get(itemId) as { count: number };
  return row.count;
}
