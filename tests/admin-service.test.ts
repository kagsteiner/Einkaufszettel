import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { AdminService } from "../src/server/admin-service.ts";
import { AuthService } from "../src/server/auth-service.ts";
import { loadConfig } from "../src/server/config.ts";
import { openDatabase } from "../src/server/database.ts";
import { HouseholdService } from "../src/server/household-service.ts";

test("the admin user list exposes useful metadata without credentials", async () => {
  const database = await openDatabase(":memory:");
  try {
    const authService = new AuthService(database, loadConfig({ APP_ENV: "test", PORT: "3000" }));
    const registered = await authService.register({
      displayName: "Alex",
      email: "alex@example.com",
      password: "Alex hat ein langes Passwort",
    });

    const users = new AdminService(database).listUsers();

    assert.deepEqual(users, [
      {
        createdAt: users[0]?.createdAt,
        displayName: "Alex",
        email: "alex@example.com",
        householdId: registered.user.householdId,
        householdName: "Mein Haushalt",
        id: registered.user.id,
        listCount: 0,
        memberCount: 1,
      },
    ]);
    assert.equal("passwordHash" in (users[0] || {}), false);
    assert.equal("openAiKey" in (users[0] || {}), false);
  } finally {
    database.close();
  }
});

test("deleting a solo user removes their household and reports image files", async () => {
  const database = await openDatabase(":memory:");
  try {
    const authService = new AuthService(database, loadConfig({ APP_ENV: "test", PORT: "3000" }));
    const registered = await authService.register({
      displayName: "Solo",
      email: "solo@example.com",
      password: "Solo hat ein langes Passwort",
    });
    insertImage(database, registered.user.householdId, registered.user.id, "solo.webp");

    const deleted = new AdminService(database).deleteUser("SOLO@example.com");

    assert.equal(deleted.deletedHousehold, true);
    assert.deepEqual(deleted.orphanedImageStorageNames, ["solo.webp"]);
    assert.equal(count(database, "users"), 0);
    assert.equal(count(database, "households"), 0);
    assert.equal(count(database, "images"), 0);
    assert.equal(count(database, "sessions"), 0);
  } finally {
    database.close();
  }
});

test("deleting a former member preserves shared data and transfers authorship", async () => {
  const database = await openDatabase(":memory:");
  try {
    const authService = new AuthService(database, loadConfig({ APP_ENV: "test", PORT: "3000" }));
    const householdService = new HouseholdService(database);
    const alex = await authService.register({
      displayName: "Alex",
      email: "alex@example.com",
      password: "Alex hat ein langes Passwort",
    });
    const bea = await authService.register({
      displayName: "Bea",
      email: "bea@example.com",
      password: "Bea hat ein langes Passwort",
    });
    const invitation = householdService.createInvitation(alex.user, bea.user.email);
    householdService.acceptInvitation(bea.user, invitation.token, false);
    insertSharedData(database, alex.user.householdId, bea.user.id);
    householdService.removeMember(alex.user, bea.user.id);

    const deleted = new AdminService(database).deleteUser(bea.user.id);

    assert.equal(deleted.deletedHousehold, true);
    assert.deepEqual(deleted.orphanedImageStorageNames, []);
    assert.equal(countWhere(database, "users", "id", bea.user.id), 0);
    assert.equal(countWhere(database, "shopping_lists", "household_id", alex.user.householdId), 1);
    assert.deepEqual(database.prepare("SELECT uploaded_by_user_id FROM images").get(), {
      uploaded_by_user_id: alex.user.id,
    });
    assert.deepEqual(database.prepare("SELECT created_by_user_id FROM shopping_lists").get(), {
      created_by_user_id: alex.user.id,
    });
    assert.deepEqual(
      database.prepare("SELECT created_by_user_id, updated_by_user_id FROM items").get(),
      { created_by_user_id: alex.user.id, updated_by_user_id: alex.user.id },
    );
    assert.deepEqual(database.prepare("SELECT created_by_user_id FROM pantry_items").get(), {
      created_by_user_id: alex.user.id,
    });
  } finally {
    database.close();
  }
});

function insertImage(
  database: Awaited<ReturnType<typeof openDatabase>>,
  householdId: string,
  userId: string,
  storageName: string,
): string {
  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO images
        (id, household_id, uploaded_by_user_id, storage_name, mime_type,
         byte_size, width, height, created_at)
       VALUES (?, ?, ?, ?, 'image/webp', 10, 1, 1, ?)`,
    )
    .run(id, householdId, userId, storageName, new Date().toISOString());
  return id;
}

function insertSharedData(
  database: Awaited<ReturnType<typeof openDatabase>>,
  householdId: string,
  userId: string,
): void {
  const now = new Date().toISOString();
  const imageId = insertImage(database, householdId, userId, "shared.webp");
  const listId = randomUUID();
  database
    .prepare(
      `INSERT INTO shopping_lists
        (id, household_id, name, normalized_name, image_id, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, 'Gemeinsam', 'gemeinsam', ?, ?, ?, ?)`,
    )
    .run(listId, householdId, imageId, userId, now, now);
  database
    .prepare(
      `INSERT INTO items
        (id, list_id, name, normalized_name, created_by_user_id, updated_by_user_id,
         created_at, updated_at)
       VALUES (?, ?, 'Milch', 'milch', ?, ?, ?, ?)`,
    )
    .run(randomUUID(), listId, userId, userId, now, now);
  database
    .prepare(
      `INSERT INTO pantry_items
        (id, household_id, name, normalized_name, created_by_user_id, created_at)
       VALUES (?, ?, 'Salz', 'salz', ?, ?)`,
    )
    .run(randomUUID(), householdId, userId, now);
}

function count(database: Awaited<ReturnType<typeof openDatabase>>, table: string): number {
  return (database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number })
    .count;
}

function countWhere(
  database: Awaited<ReturnType<typeof openDatabase>>,
  table: string,
  column: string,
  value: string,
): number {
  return (
    database.prepare(`SELECT count(*) AS count FROM ${table} WHERE ${column} = ?`).get(value) as {
      count: number;
    }
  ).count;
}
