import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  exportProductCategoryKnowledge,
  mergeProductCategoryCatalog,
} from "../scripts/product-category-files.ts";
import { AuthService, type SessionCredentials } from "../src/server/auth-service.ts";
import { loadConfig } from "../src/server/config.ts";
import type { AppDatabase } from "../src/server/database.ts";
import { openDatabase } from "../src/server/database.ts";

let database: AppDatabase;
let firstUser: SessionCredentials;
let secondUser: SessionCredentials;

before(async () => {
  database = await openDatabase(":memory:");
  const auth = new AuthService(database, loadConfig({ APP_ENV: "test", PORT: "3000" }));
  firstUser = await auth.register({
    displayName: "Katalog Eins",
    email: "katalog-eins@example.com",
    password: "Katalog Eins hat ein langes Passwort",
  });
  secondUser = await auth.register({
    displayName: "Katalog Zwei",
    email: "katalog-zwei@example.com",
    password: "Katalog Zwei hat ein langes Passwort",
  });
});

after(() => database.close());

test("the export contains agreements and separates household conflicts", () => {
  insertKnowledge(firstUser, "Hafercuisine", "staples", "2026-07-24T10:00:00.000Z");
  insertKnowledge(secondUser, "HAFERCUISINE", "staples", "2026-07-24T11:00:00.000Z");
  insertKnowledge(firstUser, "Räuchertofu", "produce", "2026-07-24T10:00:00.000Z");
  insertKnowledge(secondUser, "Räuchertofu", "staples", "2026-07-24T11:00:00.000Z");

  assert.deepEqual(exportProductCategoryKnowledge(database), {
    conflicts: [{ categories: ["produce", "staples"], name: "Räuchertofu" }],
    products: [{ category: "staples", name: "HAFERCUISINE" }],
    version: 1,
  });
});

test("catalog imports are sorted, additive, and reject category conflicts", () => {
  const merged = mergeProductCategoryCatalog(
    {
      products: [{ category: "dairy", name: "Butter" }],
      version: 1,
    },
    {
      products: [
        { category: "dairy", name: "BUTTER" },
        { category: "produce", name: "Apfel" },
      ],
      version: 1,
    },
  );
  assert.deepEqual(merged, {
    products: [
      { category: "produce", name: "Apfel" },
      { category: "dairy", name: "Butter" },
    ],
    version: 1,
  });

  assert.throws(
    () =>
      mergeProductCategoryCatalog(merged, {
        products: [{ category: "staples", name: "Butter" }],
        version: 1,
      }),
    /Katalogkonflikte/,
  );
  assert.throws(
    () =>
      mergeProductCategoryCatalog(merged, {
        conflicts: [{ categories: ["dairy", "staples"], name: "Butter" }],
        products: [],
        version: 1,
      }),
    /ungelöste Konflikte/,
  );
});

function insertKnowledge(
  user: SessionCredentials,
  name: string,
  category: string,
  updatedAt: string,
): void {
  database
    .prepare(
      `INSERT INTO household_product_categories
        (household_id, normalized_name, name, category, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      user.user.householdId,
      name.toLocaleLowerCase("de-DE"),
      name,
      category,
      updatedAt,
      updatedAt,
    );
}
