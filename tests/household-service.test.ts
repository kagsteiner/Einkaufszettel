import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { AuthService, type SessionCredentials } from "../src/server/auth-service.ts";
import { loadConfig } from "../src/server/config.ts";
import type { AppDatabase } from "../src/server/database.ts";
import { openDatabase } from "../src/server/database.ts";
import { HouseholdService } from "../src/server/household-service.ts";

let database: AppDatabase;
let householdService: HouseholdService;
let inviter: SessionCredentials;
let invited: SessionCredentials;

before(async () => {
  database = await openDatabase(":memory:");
  const authService = new AuthService(database, loadConfig({ APP_ENV: "test", PORT: "3000" }));
  householdService = new HouseholdService(database);
  inviter = await authService.register({
    displayName: "Alex",
    email: "alex@example.com",
    password: "Alex hat ein langes Passwort",
  });
  invited = await authService.register({
    displayName: "Bea",
    email: "bea@example.com",
    password: "Bea hat ein langes Passwort",
  });
});

after(() => database.close());

test("an invitation is restricted to its normalized email address", async () => {
  const invitation = householdService.createInvitation(inviter.user, "BEA@example.com");
  const preview = householdService.previewInvitation(invited.user, invitation.token);

  assert.equal(preview.householdName, "Mein Haushalt");
  assert.equal(preview.canMoveExistingData, true);
  assert.equal(preview.existingListCount, 0);
  assert.throws(
    () => householdService.previewInvitation(inviter.user, invitation.token),
    /andere E-Mail-Adresse/,
  );
});

test("a solo user can move lists and merge pantry data when joining", () => {
  const now = new Date().toISOString();
  insertList(inviter.user.householdId, inviter.user.id, "Aldi", now);
  insertList(invited.user.householdId, invited.user.id, "Aldi", now);
  insertPantry(inviter.user.householdId, inviter.user.id, "Salz", "salz", now);
  insertPantry(invited.user.householdId, invited.user.id, "SALZ", "salz", now);
  insertPantry(invited.user.householdId, invited.user.id, "Öl", "öl", now);
  const sourceHouseholdId = invited.user.householdId;
  const invitation = householdService.createInvitation(inviter.user, invited.user.email);

  const result = householdService.acceptInvitation(invited.user, invitation.token, true);

  assert.equal(result.householdId, inviter.user.householdId);
  const lists = database
    .prepare("SELECT name FROM shopping_lists WHERE household_id = ? ORDER BY name")
    .all(inviter.user.householdId) as Array<{ name: string }>;
  assert.deepEqual(
    lists.map((list) => list.name),
    ["Aldi", "Aldi (alter Haushalt)"],
  );
  const pantry = database
    .prepare(
      "SELECT normalized_name FROM pantry_items WHERE household_id = ? ORDER BY normalized_name",
    )
    .all(inviter.user.householdId) as Array<{ normalized_name: string }>;
  assert.deepEqual(
    pantry.map((item) => item.normalized_name),
    ["salz", "öl"],
  );
  assert.equal(
    (
      database
        .prepare("SELECT count(*) AS count FROM households WHERE id = ?")
        .get(sourceHouseholdId) as { count: number }
    ).count,
    0,
  );
});

function insertList(householdId: string, userId: string, name: string, now: string): void {
  database
    .prepare(
      `INSERT INTO shopping_lists
        (id, household_id, name, normalized_name, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), householdId, name, name.toLowerCase(), userId, now, now);
}

function insertPantry(
  householdId: string,
  userId: string,
  name: string,
  normalizedName: string,
  now: string,
): void {
  database
    .prepare(
      `INSERT INTO pantry_items
        (id, household_id, name, normalized_name, created_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), householdId, name, normalizedName, userId, now);
}
