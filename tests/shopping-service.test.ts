import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { AuthService, type SessionCredentials } from "../src/server/auth-service.ts";
import { loadConfig } from "../src/server/config.ts";
import type { AppDatabase } from "../src/server/database.ts";
import { openDatabase } from "../src/server/database.ts";
import { ShoppingService } from "../src/server/shopping-service.ts";

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
    displayName: "Chris",
    email: "chris@example.com",
    password: "Chris hat ein langes Passwort",
  });
  outsider = await auth.register({
    displayName: "Dana",
    email: "dana@example.com",
    password: "Dana hat ein langes Passwort",
  });
  listId = shopping.createList(owner.user, "Supermarkt").id;
});

after(() => database.close());

test("product matching is case-independent while display casing is preserved", () => {
  const created = shopping.addItem(owner.user, listId, {
    name: "iPhoneCase",
    quantities: [{ amount: "1", unit: "Stk." }],
  });
  const merged = shopping.addItem(owner.user, listId, {
    name: "IPHONECASE",
    quantities: [{ amount: "2", unit: "Stück" }],
  });

  assert.equal(created.merge, "created");
  assert.equal(merged.merge, "increased");
  assert.equal(merged.item.name, "iPhoneCase");
  assert.deepEqual(
    merged.item.quantities.map(({ amount, unit }) => ({ amount, unit })),
    [{ amount: "3", unit: "Stück" }],
  );
});

test("different units are appended without conversion", () => {
  shopping.addItem(owner.user, listId, {
    name: "Mehl",
    quantities: [{ amount: "2", unit: "Tassen" }],
  });
  const merged = shopping.addItem(owner.user, listId, {
    name: "mehl",
    quantities: [{ amount: "500", unit: "g" }],
  });

  assert.equal(merged.merge, "appended");
  assert.deepEqual(
    merged.item.quantities.map(({ amount, unit }) => `${amount} ${unit}`),
    ["2 Tasse", "500 g"],
  );
});

test("household authorization is enforced for list and item writes", () => {
  assert.throws(
    () => shopping.addItem(outsider.user, listId, { name: "Nicht erlaubt" }),
    /nicht gefunden/,
  );
  assert.throws(() => shopping.deleteList(outsider.user, listId), /nicht gefunden/);
});

test("completed items are reactivated when added again", () => {
  const created = shopping.addItem(owner.user, listId, { name: "Brot" });
  assert.ok(shopping.setCompleted(owner.user, created.item.id, true).completedAt);

  const merged = shopping.addItem(owner.user, listId, { name: "brot" });
  assert.equal(merged.merge, "unchanged");
  assert.equal(merged.item.completedAt, null);
});

test("a recipe selection is applied atomically", () => {
  const before = database
    .prepare("SELECT count(*) AS count FROM items WHERE list_id = ?")
    .get(listId)?.count;
  assert.throws(
    () =>
      shopping.addRecipeItems(owner.user, listId, [
        { amount: "1", category: "produce", name: "Birnen", note: null, unit: "Stück" },
        { amount: "ungültig", category: "other", name: "Fehler", note: null, unit: "" },
      ]),
    /Menge/,
  );
  assert.equal(
    database.prepare("SELECT count(*) AS count FROM items WHERE list_id = ?").get(listId)?.count,
    before,
  );
});
