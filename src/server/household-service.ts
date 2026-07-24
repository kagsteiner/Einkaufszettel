import { randomUUID } from "node:crypto";
import type { AuthenticatedUser } from "./auth-service.ts";
import type { AppDatabase } from "./database.ts";
import { inTransaction } from "./database.ts";
import { AppError, forbidden } from "./errors.ts";
import { createOpaqueToken, hashToken, normalizeEmail } from "./security.ts";
import { normalizeComparableText } from "./text.ts";

const invitationLifetimeMilliseconds = 7 * 24 * 60 * 60 * 1_000;

type InvitationRow = {
  accepted_at: string | null;
  expires_at: string;
  household_id: string;
  household_name: string;
  id: string;
  invited_email_normalized: string;
};

type ListRow = { id: string; name: string };
type PantryRow = {
  created_at: string;
  created_by_user_id: string;
  name: string;
  normalized_name: string;
};

export type InvitationPreview = Readonly<{
  canMoveExistingData: boolean;
  existingListCount: number;
  existingPantryCount: number;
  expiresAt: string;
  householdName: string;
}>;

export class HouseholdService {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  createInvitation(
    user: AuthenticatedUser,
    emailValue: unknown,
  ): { expiresAt: string; token: string } {
    const email = normalizeEmail(emailValue);
    const existingMember = this.database
      .prepare(
        `SELECT 1
         FROM users u JOIN household_members hm ON hm.user_id = u.id
         WHERE hm.household_id = ? AND u.email_normalized = ?`,
      )
      .get(user.householdId, email.normalized);
    if (existingMember) {
      throw new AppError(409, "already_member", "Diese Person gehört bereits zum Haushalt.");
    }

    const token = createOpaqueToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + invitationLifetimeMilliseconds).toISOString();
    this.database
      .prepare(
        `INSERT INTO invitations
          (id, household_id, invited_email, invited_email_normalized, token_hash,
           created_by_user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        user.householdId,
        email.display,
        email.normalized,
        hashToken(token),
        user.id,
        now.toISOString(),
        expiresAt,
      );
    return { expiresAt, token };
  }

  previewInvitation(user: AuthenticatedUser, token: string): InvitationPreview {
    const invitation = this.getInvitation(token);
    this.assertInvitationMayBeUsed(invitation, user);
    return {
      canMoveExistingData:
        invitation.household_id !== user.householdId && this.countMembers(user.householdId) === 1,
      existingListCount: this.countRows("shopping_lists", user.householdId),
      existingPantryCount: this.countRows("pantry_items", user.householdId),
      expiresAt: invitation.expires_at,
      householdName: invitation.household_name,
    };
  }

  acceptInvitation(
    user: AuthenticatedUser,
    token: string,
    moveExistingData: boolean,
  ): { householdId: string; householdName: string } {
    return inTransaction(this.database, () => {
      const invitation = this.getInvitation(token);
      this.assertInvitationMayBeUsed(invitation, user);
      const sourceHouseholdId = user.householdId;
      const targetHouseholdId = invitation.household_id;

      if (sourceHouseholdId === targetHouseholdId) {
        throw new AppError(409, "already_member", "Du gehörst bereits zu diesem Haushalt.");
      }
      const sourceMemberCount = this.countMembers(sourceHouseholdId);
      if (moveExistingData && sourceMemberCount !== 1) {
        throw new AppError(
          409,
          "household_not_solo",
          "Daten können nur aus einem persönlichen Haushalt mitgenommen werden.",
        );
      }

      if (moveExistingData) {
        this.moveLists(sourceHouseholdId, targetHouseholdId);
        this.movePantry(sourceHouseholdId, targetHouseholdId);
        this.moveProductCategories(sourceHouseholdId, targetHouseholdId);
        this.database
          .prepare("UPDATE images SET household_id = ? WHERE household_id = ?")
          .run(targetHouseholdId, sourceHouseholdId);
      }

      const acceptedAt = new Date().toISOString();
      this.database
        .prepare("UPDATE household_members SET household_id = ?, joined_at = ? WHERE user_id = ?")
        .run(targetHouseholdId, acceptedAt, user.id);
      this.database
        .prepare("UPDATE invitations SET accepted_at = ?, accepted_by_user_id = ? WHERE id = ?")
        .run(acceptedAt, user.id, invitation.id);

      if (sourceMemberCount === 1) {
        this.database.prepare("DELETE FROM households WHERE id = ?").run(sourceHouseholdId);
      }
      return { householdId: targetHouseholdId, householdName: invitation.household_name };
    });
  }

  removeMember(
    user: AuthenticatedUser,
    memberId: string,
  ): { householdId: string; removedMemberId: string } {
    if (memberId === user.id) {
      throw new AppError(
        400,
        "cannot_remove_self",
        "Du kannst dich hier nicht selbst aus dem Haushalt entfernen.",
      );
    }

    return inTransaction(this.database, () => {
      const member = this.database
        .prepare(
          `SELECT u.id
           FROM users u JOIN household_members hm ON hm.user_id = u.id
           WHERE u.id = ? AND hm.household_id = ?`,
        )
        .get(memberId, user.householdId) as { id: string } | undefined;
      if (!member) {
        throw new AppError(
          404,
          "household_member_not_found",
          "Diese Person gehört nicht zu deinem Haushalt.",
        );
      }

      const householdId = randomUUID();
      const now = new Date().toISOString();
      this.database
        .prepare("INSERT INTO households (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
        .run(householdId, "Mein Haushalt", now, now);
      this.database
        .prepare("UPDATE household_members SET household_id = ?, joined_at = ? WHERE user_id = ?")
        .run(householdId, now, member.id);
      this.database
        .prepare("DELETE FROM invitations WHERE created_by_user_id = ? AND accepted_at IS NULL")
        .run(member.id);

      return { householdId, removedMemberId: member.id };
    });
  }

  private getInvitation(token: string): InvitationRow {
    if (!token || token.length > 200) {
      throw new AppError(404, "invitation_not_found", "Diese Einladung wurde nicht gefunden.");
    }
    const row = this.database
      .prepare(
        `SELECT i.id, i.household_id, i.invited_email_normalized, i.expires_at, i.accepted_at,
                h.name AS household_name
         FROM invitations i JOIN households h ON h.id = i.household_id
         WHERE i.token_hash = ?`,
      )
      .get(hashToken(token)) as InvitationRow | undefined;
    if (!row) {
      throw new AppError(404, "invitation_not_found", "Diese Einladung wurde nicht gefunden.");
    }
    return row;
  }

  private assertInvitationMayBeUsed(invitation: InvitationRow, user: AuthenticatedUser): void {
    if (invitation.invited_email_normalized !== normalizeEmail(user.email).normalized) {
      throw forbidden("Diese Einladung wurde für eine andere E-Mail-Adresse ausgestellt.");
    }
    if (invitation.accepted_at || Date.parse(invitation.expires_at) <= Date.now()) {
      throw new AppError(410, "invitation_expired", "Diese Einladung ist nicht mehr gültig.");
    }
  }

  private countMembers(householdId: string): number {
    const row = this.database
      .prepare("SELECT count(*) AS count FROM household_members WHERE household_id = ?")
      .get(householdId) as { count: number };
    return row.count;
  }

  private countRows(table: "pantry_items" | "shopping_lists", householdId: string): number {
    const row = this.database
      .prepare(`SELECT count(*) AS count FROM ${table} WHERE household_id = ?`)
      .get(householdId) as { count: number };
    return row.count;
  }

  private moveLists(sourceHouseholdId: string, targetHouseholdId: string): void {
    const lists = this.database
      .prepare("SELECT id, name FROM shopping_lists WHERE household_id = ? ORDER BY created_at")
      .all(sourceHouseholdId) as ListRow[];
    const existingNames = new Set(
      (
        this.database
          .prepare("SELECT normalized_name FROM shopping_lists WHERE household_id = ?")
          .all(targetHouseholdId) as Array<{ normalized_name: string }>
      ).map((row) => row.normalized_name),
    );

    for (const list of lists) {
      let name = list.name;
      let normalizedName = normalizeComparableText(name);
      if (existingNames.has(normalizedName)) {
        let suffix = 1;
        do {
          name = `${list.name} (alter Haushalt${suffix === 1 ? "" : ` ${suffix}`})`;
          normalizedName = normalizeComparableText(name);
          suffix += 1;
        } while (existingNames.has(normalizedName));
      }
      this.database
        .prepare(
          `UPDATE shopping_lists
           SET household_id = ?, name = ?, normalized_name = ?, updated_at = ? WHERE id = ?`,
        )
        .run(targetHouseholdId, name, normalizedName, new Date().toISOString(), list.id);
      existingNames.add(normalizedName);
    }
  }

  private movePantry(sourceHouseholdId: string, targetHouseholdId: string): void {
    const pantry = this.database
      .prepare("SELECT * FROM pantry_items WHERE household_id = ?")
      .all(sourceHouseholdId) as PantryRow[];
    const insert = this.database.prepare(
      `INSERT OR IGNORE INTO pantry_items
        (id, household_id, name, normalized_name, created_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const item of pantry) {
      insert.run(
        randomUUID(),
        targetHouseholdId,
        item.name,
        item.normalized_name,
        item.created_by_user_id,
        item.created_at,
      );
    }
  }

  private moveProductCategories(sourceHouseholdId: string, targetHouseholdId: string): void {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO household_product_categories
          (household_id, normalized_name, name, category, created_at, updated_at)
         SELECT ?, normalized_name, name, category, created_at, updated_at
         FROM household_product_categories
         WHERE household_id = ?`,
      )
      .run(targetHouseholdId, sourceHouseholdId);
  }
}
