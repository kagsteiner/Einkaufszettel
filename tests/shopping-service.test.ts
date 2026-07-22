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

test("direct additions infer a useful category from the product name", () => {
  const created = shopping.addItem(owner.user, listId, {
    name: "Schlagsahne",
  });

  assert.equal(created.item.category, "dairy");
});

test("product suggestions prefer frequent use and use recency as a tie-breaker", () => {
  const frequent = shopping.addItem(owner.user, listId, { name: "Test Mohnmilch" });
  const recent = shopping.addItem(owner.user, listId, { name: "Test Mandelmilch" });
  shopping.setCompleted(owner.user, frequent.item.id, true);
  shopping.setCompleted(owner.user, frequent.item.id, false);
  shopping.setCompleted(owner.user, frequent.item.id, true);
  shopping.setCompleted(owner.user, recent.item.id, true);

  let matches = shopping
    .getProductSuggestions(owner.user)
    .filter((suggestion) => suggestion.name.startsWith("Test M"));
  assert.deepEqual(
    matches.map((suggestion) => suggestion.name),
    ["Test Mohnmilch", "Test Mandelmilch"],
  );

  database
    .prepare("DELETE FROM item_purchase_events WHERE item_id IN (?, ?)")
    .run(frequent.item.id, recent.item.id);
  database
    .prepare("UPDATE items SET updated_at = ? WHERE id = ?")
    .run("2026-01-01T00:00:00.000Z", frequent.item.id);
  database
    .prepare("UPDATE items SET updated_at = ? WHERE id = ?")
    .run("2026-02-01T00:00:00.000Z", recent.item.id);

  matches = shopping
    .getProductSuggestions(owner.user)
    .filter((suggestion) => suggestion.name.startsWith("Test M"));
  assert.deepEqual(
    matches.map((suggestion) => suggestion.name),
    ["Test Mandelmilch", "Test Mohnmilch"],
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

test("editorial and inflected units merge through their canonical unit", () => {
  shopping.addItem(owner.user, listId, {
    name: "Kichererbsen",
    quantities: [{ amount: "1", unit: "Dose(n)" }],
  });
  const merged = shopping.addItem(owner.user, listId, {
    name: "kichererbsen",
    quantities: [{ amount: "2", unit: "Dosen" }],
  });

  assert.equal(merged.merge, "increased");
  assert.deepEqual(
    merged.item.quantities.map(({ amount, unit }) => ({ amount, unit })),
    [{ amount: "3", unit: "Dose" }],
  );
});

test("recipe ranges add their upper bound to the shopping list", () => {
  const [created] = shopping.addRecipeItems(owner.user, listId, [
    { amount: "200-250", category: "produce", name: "Pilze", note: null, unit: "g" },
  ]);

  assert.deepEqual(
    created?.item.quantities.map(({ amount, unit }) => ({ amount, unit })),
    [{ amount: "250", unit: "g" }],
  );
});

test("qualitative recipe amounts are preserved instead of guessed", () => {
  shopping.addRecipeItems(owner.user, listId, [
    { amount: "einige", category: "spices", name: "Salbeiblätter", note: null, unit: null },
  ]);
  const [merged] = shopping.addRecipeItems(owner.user, listId, [
    { amount: "einige", category: "spices", name: "salbeiblätter", note: null, unit: null },
  ]);

  assert.deepEqual(
    merged?.item.quantities.map(({ amount, unit }) => ({ amount, unit })),
    [{ amount: "2 × einige", unit: "" }],
  );
});

test("household authorization is enforced for list and item writes", () => {
  assert.throws(
    () => shopping.addItem(outsider.user, listId, { name: "Nicht erlaubt" }),
    /nicht gefunden/,
  );
  assert.throws(() => shopping.deleteList(outsider.user, listId), /nicht gefunden/);
});

test("completed items are reactivated with only the newly requested quantity", () => {
  const created = shopping.addItem(owner.user, listId, {
    name: "Eier",
    quantities: [{ amount: "5", unit: "Stück" }],
  });
  assert.ok(shopping.setCompleted(owner.user, created.item.id, true).completedAt);

  const [reactivated] = shopping.addRecipeItems(owner.user, listId, [
    { amount: "3", category: "dairy", name: "eier", note: null, unit: "Stück" },
  ]);

  assert.ok(reactivated);
  assert.equal(reactivated.merge, "reactivated");
  assert.equal(reactivated.item.completedAt, null);
  assert.deepEqual(
    reactivated.item.quantities.map(({ amount, unit }) => ({ amount, unit })),
    [{ amount: "3", unit: "Stück" }],
  );
});

test("a recipe selection is applied atomically", () => {
  const before = (
    database.prepare("SELECT count(*) AS count FROM items WHERE list_id = ?").get(listId) as {
      count: number;
    }
  ).count;
  assert.throws(
    () =>
      shopping.addRecipeItems(owner.user, listId, [
        { amount: "1", category: "produce", name: "Birnen", note: null, unit: "Stück" },
        { amount: "ungültig", category: "other", name: "Fehler", note: null, unit: "" },
      ]),
    /Menge/,
  );
  assert.equal(
    (
      database.prepare("SELECT count(*) AS count FROM items WHERE list_id = ?").get(listId) as {
        count: number;
      }
    ).count,
    before,
  );
});
