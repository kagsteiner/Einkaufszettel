import type { AppDatabase } from "./database.ts";
import { inTransaction } from "./database.ts";
import { AppError } from "./errors.ts";
import { normalizeEmail } from "./security.ts";

type AdminUserRow = {
  created_at: string;
  display_name: string;
  email: string;
  household_id: string;
  household_name: string;
  id: string;
  list_count: number;
  member_count: number;
};

export type AdminUser = Readonly<{
  createdAt: string;
  displayName: string;
  email: string;
  householdId: string;
  householdName: string;
  id: string;
  listCount: number;
  memberCount: number;
}>;

export type DeletedUser = Readonly<{
  deletedHousehold: boolean;
  displayName: string;
  email: string;
  id: string;
  orphanedImageStorageNames: ReadonlyArray<string>;
}>;

export class AdminService {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  listUsers(): AdminUser[] {
    return (
      this.database
        .prepare(
          `SELECT u.id, u.email, u.display_name, u.created_at,
                  h.id AS household_id, h.name AS household_name,
                  (SELECT count(*) FROM household_members members
                   WHERE members.household_id = h.id) AS member_count,
                  (SELECT count(*) FROM shopping_lists lists
                   WHERE lists.household_id = h.id) AS list_count
           FROM users u
           JOIN household_members hm ON hm.user_id = u.id
           JOIN households h ON h.id = hm.household_id
           ORDER BY u.created_at, u.email_normalized`,
        )
        .all() as AdminUserRow[]
    ).map(toAdminUser);
  }

  findUser(identifier: string): AdminUser {
    const value = identifier.trim();
    if (!value) {
      throw new AppError(400, "user_identifier_required", "Benutzer-ID oder E-Mail fehlt.");
    }
    const normalizedEmail = value.includes("@") ? normalizeEmail(value).normalized : null;
    const row = this.database
      .prepare(
        `SELECT u.id, u.email, u.display_name, u.created_at,
                h.id AS household_id, h.name AS household_name,
                (SELECT count(*) FROM household_members members
                 WHERE members.household_id = h.id) AS member_count,
                (SELECT count(*) FROM shopping_lists lists
                 WHERE lists.household_id = h.id) AS list_count
         FROM users u
         JOIN household_members hm ON hm.user_id = u.id
         JOIN households h ON h.id = hm.household_id
         WHERE u.id = ? OR u.email_normalized = ?`,
      )
      .get(value, normalizedEmail) as AdminUserRow | undefined;
    if (!row) {
      throw new AppError(404, "user_not_found", "Dieser Benutzer wurde nicht gefunden.");
    }
    return toAdminUser(row);
  }

  deleteUser(identifier: string): DeletedUser {
    return inTransaction(this.database, () => {
      const user = this.findUser(identifier);
      const deletesHousehold = user.memberCount === 1;
      const orphanedImageStorageNames = deletesHousehold
        ? (
            this.database
              .prepare("SELECT storage_name FROM images WHERE household_id = ?")
              .all(user.householdId) as Array<{ storage_name: string }>
          ).map((image) => image.storage_name)
        : [];

      const referencedHouseholds = this.referencedHouseholdIds(user.id);
      for (const householdId of referencedHouseholds) {
        if (deletesHousehold && householdId === user.householdId) {
          continue;
        }
        const replacement = this.database
          .prepare(
            `SELECT user_id
             FROM household_members
             WHERE household_id = ? AND user_id <> ?
             ORDER BY joined_at, user_id
             LIMIT 1`,
          )
          .get(householdId, user.id) as { user_id: string } | undefined;
        if (!replacement) {
          throw new AppError(
            409,
            "authorship_cannot_be_transferred",
            "Gemeinsame Daten konnten keinem verbleibenden Haushaltsmitglied zugeordnet werden.",
          );
        }
        this.transferAuthorship(user.id, replacement.user_id, householdId);
      }

      this.database
        .prepare("DELETE FROM invitations WHERE created_by_user_id = ? OR accepted_by_user_id = ?")
        .run(user.id, user.id);
      if (deletesHousehold) {
        this.database.prepare("DELETE FROM households WHERE id = ?").run(user.householdId);
      }
      this.database.prepare("DELETE FROM users WHERE id = ?").run(user.id);

      return {
        deletedHousehold: deletesHousehold,
        displayName: user.displayName,
        email: user.email,
        id: user.id,
        orphanedImageStorageNames,
      };
    });
  }

  private referencedHouseholdIds(userId: string): string[] {
    return (
      this.database
        .prepare(
          `SELECT household_id FROM images WHERE uploaded_by_user_id = ?
           UNION
           SELECT household_id FROM shopping_lists WHERE created_by_user_id = ?
           UNION
           SELECT l.household_id
           FROM items i JOIN shopping_lists l ON l.id = i.list_id
           WHERE i.created_by_user_id = ? OR i.updated_by_user_id = ?
           UNION
           SELECT household_id FROM pantry_items WHERE created_by_user_id = ?`,
        )
        .all(userId, userId, userId, userId, userId) as Array<{ household_id: string }>
    ).map((row) => row.household_id);
  }

  private transferAuthorship(userId: string, replacementUserId: string, householdId: string): void {
    this.database
      .prepare(
        "UPDATE images SET uploaded_by_user_id = ? WHERE household_id = ? AND uploaded_by_user_id = ?",
      )
      .run(replacementUserId, householdId, userId);
    this.database
      .prepare(
        "UPDATE shopping_lists SET created_by_user_id = ? WHERE household_id = ? AND created_by_user_id = ?",
      )
      .run(replacementUserId, householdId, userId);
    this.database
      .prepare(
        `UPDATE items SET created_by_user_id = ?
         WHERE created_by_user_id = ? AND list_id IN
           (SELECT id FROM shopping_lists WHERE household_id = ?)`,
      )
      .run(replacementUserId, userId, householdId);
    this.database
      .prepare(
        `UPDATE items SET updated_by_user_id = ?
         WHERE updated_by_user_id = ? AND list_id IN
           (SELECT id FROM shopping_lists WHERE household_id = ?)`,
      )
      .run(replacementUserId, userId, householdId);
    this.database
      .prepare(
        "UPDATE pantry_items SET created_by_user_id = ? WHERE household_id = ? AND created_by_user_id = ?",
      )
      .run(replacementUserId, householdId, userId);
  }
}

function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    createdAt: row.created_at,
    displayName: row.display_name,
    email: row.email,
    householdId: row.household_id,
    householdName: row.household_name,
    id: row.id,
    listCount: row.list_count,
    memberCount: row.member_count,
  };
}
