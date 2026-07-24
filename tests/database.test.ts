import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { AuthService } from "../src/server/auth-service.ts";
import { loadConfig } from "../src/server/config.ts";
import type { AppDatabase } from "../src/server/database.ts";
import { openDatabase } from "../src/server/database.ts";
import { ShoppingService } from "../src/server/shopping-service.ts";

let database: AppDatabase;
let temporaryDirectory: string;

before(async () => {
  temporaryDirectory = await mkdtemp(resolve(tmpdir(), "einkaufszettel-db-"));
  database = await openDatabase(resolve(temporaryDirectory, "test.db"));
});

after(async () => {
  database.close();
  await rm(temporaryDirectory, { force: true, recursive: true });
});

test("all initial tables are created by the migration runner", () => {
  const rows = database
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>;
  const names = rows.map((row) => row.name);

  for (const requiredTable of [
    "household_members",
    "household_product_categories",
    "households",
    "images",
    "invitations",
    "item_purchase_events",
    "items",
    "pantry_items",
    "password_reset_tokens",
    "quantity_parts",
    "schema_migrations",
    "sessions",
    "shopping_lists",
    "users",
  ]) {
    assert.ok(names.includes(requiredTable), `Tabelle ${requiredTable} fehlt`);
  }
  const migrationCount = database
    .prepare("SELECT count(*) AS count FROM schema_migrations")
    .get() as {
    count: number;
  };
  assert.equal(migrationCount.count, 6);
});

test("foreign keys are active", () => {
  assert.throws(
    () =>
      database
        .prepare(
          "INSERT INTO household_members (household_id, user_id, joined_at) VALUES (?, ?, ?)",
        )
        .run("missing-household", "missing-user", new Date().toISOString()),
    /FOREIGN KEY constraint failed/,
  );
});

test("the purchase-history migration seeds already completed items", async () => {
  const legacyMigrationDirectory = resolve(temporaryDirectory, "legacy-migrations");
  await mkdir(legacyMigrationDirectory);
  for (const migration of ["001-initial.sql", "002-quantity-order.sql"]) {
    await copyFile(resolve("migrations", migration), resolve(legacyMigrationDirectory, migration));
  }
  const legacyDatabasePath = resolve(temporaryDirectory, "legacy.db");
  const legacyDatabase = await openDatabase(legacyDatabasePath, legacyMigrationDirectory);
  const auth = new AuthService(legacyDatabase, loadConfig({ APP_ENV: "test", PORT: "3000" }));
  const user = await auth.register({
    displayName: "Migrationstest",
    email: "migration@example.com",
    password: "Ein langes Passwort für Migrationen",
  });
  const legacyShopping = new ShoppingService(legacyDatabase);
  const legacyListId = legacyShopping.createList(user.user, "Altbestand").id;
  const legacyItemId = randomUUID();
  const completedAt = "2026-07-18T10:00:00.000Z";
  legacyDatabase
    .prepare(
      `INSERT INTO items
        (id, list_id, name, normalized_name, note, completed_at, created_by_user_id,
         updated_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      legacyItemId,
      legacyListId,
      "Reis",
      "reis",
      "Nur diese Sorte",
      completedAt,
      user.user.id,
      user.user.id,
      completedAt,
      completedAt,
    );
  legacyDatabase.close();

  const migratedDatabase = await openDatabase(legacyDatabasePath);
  const event = migratedDatabase
    .prepare("SELECT purchased_at FROM item_purchase_events WHERE item_id = ?")
    .get(legacyItemId) as { purchased_at: string };
  assert.equal(event.purchased_at, completedAt);
  const migratedItem = migratedDatabase
    .prepare("SELECT note, purchase_note FROM items WHERE id = ?")
    .get(legacyItemId) as { note: string; purchase_note: string | null };
  assert.deepEqual(migratedItem, { note: "Nur diese Sorte", purchase_note: null });
  migratedDatabase.close();
});
