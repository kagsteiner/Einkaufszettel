import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import type { AppDatabase } from "../src/server/database.ts";
import { openDatabase } from "../src/server/database.ts";

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
    "households",
    "images",
    "invitations",
    "items",
    "pantry_items",
    "quantity_parts",
    "schema_migrations",
    "sessions",
    "shopping_lists",
    "users",
  ]) {
    assert.ok(names.includes(requiredTable), `Tabelle ${requiredTable} fehlt`);
  }
  assert.equal(database.prepare("SELECT count(*) AS count FROM schema_migrations").get()?.count, 1);
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
