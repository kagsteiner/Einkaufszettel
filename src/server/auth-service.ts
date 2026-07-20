import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.ts";
import type { AppDatabase } from "./database.ts";
import { inTransaction } from "./database.ts";
import { AppError, unauthorized } from "./errors.ts";
import {
  createOpaqueToken,
  hashPassword,
  hashToken,
  normalizeDisplayName,
  normalizeEmail,
  tokenMatches,
  validatePassword,
  verifyPassword,
} from "./security.ts";

const sessionLifetimeMilliseconds = 30 * 24 * 60 * 60 * 1_000;
const passwordResetLifetimeMilliseconds = 30 * 60 * 1_000;
const dummyPasswordHash =
  "$argon2id$v=19$m=65536,t=3,p=1$0OftY+Vh5hCeZMToNkiRsQ$ioGpHMWbCro+Qz25b9Lzv2ybAKECqnfBnIRg9GnDiD8";

type UserRow = {
  id: string;
  email: string;
  email_normalized: string;
  display_name: string;
  password_hash: string;
  household_id: string;
  household_name: string;
  openai_key_last_four: string | null;
};

export type AuthenticatedUser = Readonly<{
  displayName: string;
  email: string;
  householdId: string;
  householdName: string;
  id: string;
  openAiKeyMask: string | null;
}>;

export type SessionCredentials = Readonly<{
  csrfToken: string;
  expiresAt: string;
  sessionToken: string;
  user: AuthenticatedUser;
}>;

export class AuthService {
  private readonly database: AppDatabase;
  private readonly config: AppConfig;

  constructor(database: AppDatabase, config: AppConfig) {
    this.database = database;
    this.config = config;
  }

  async register(input: {
    displayName: unknown;
    email: unknown;
    password: unknown;
  }): Promise<SessionCredentials> {
    const email = normalizeEmail(input.email);
    const displayName = normalizeDisplayName(input.displayName);
    const password = validatePassword(input.password);
    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();
    const userId = randomUUID();
    const householdId = randomUUID();

    try {
      return inTransaction(this.database, () => {
        this.database
          .prepare(
            `INSERT INTO users
              (id, email, email_normalized, display_name, password_hash, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(userId, email.display, email.normalized, displayName, passwordHash, now, now);
        this.database
          .prepare("INSERT INTO households (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
          .run(householdId, "Mein Haushalt", now, now);
        this.database
          .prepare(
            "INSERT INTO household_members (household_id, user_id, joined_at) VALUES (?, ?, ?)",
          )
          .run(householdId, userId, now);
        return this.createSession(this.getUserById(userId), now);
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AppError(
          409,
          "email_exists",
          "Für diese E-Mail-Adresse gibt es bereits ein Konto.",
        );
      }
      throw error;
    }
  }

  async login(input: { email: unknown; password: unknown }): Promise<SessionCredentials> {
    const email = normalizeEmail(input.email);
    const password = typeof input.password === "string" ? input.password : "";
    const row = this.database
      .prepare(`${userQuery} WHERE u.email_normalized = ?`)
      .get(email.normalized) as UserRow | undefined;

    const passwordIsValid = await verifyPassword(row?.password_hash || dummyPasswordHash, password);
    if (!row || !passwordIsValid) {
      throw unauthorized("E-Mail-Adresse oder Passwort ist nicht korrekt.");
    }
    return this.createSession(row, new Date().toISOString());
  }

  authenticate(sessionToken: string | null): AuthenticatedUser {
    if (!sessionToken) {
      throw unauthorized();
    }
    const now = new Date().toISOString();
    const row = this.database
      .prepare(
        `${userQuery}
         JOIN sessions s ON s.user_id = u.id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get(hashToken(sessionToken), now) as UserRow | undefined;
    if (!row) {
      throw unauthorized();
    }
    return toAuthenticatedUser(row, this.config.developmentOpenAiApiKey !== null);
  }

  verifyCsrf(sessionToken: string | null, csrfToken: string | null): void {
    if (!sessionToken || !csrfToken) {
      throw new AppError(403, "invalid_csrf", "Die Sicherheitsprüfung ist fehlgeschlagen.");
    }
    const row = this.database
      .prepare("SELECT csrf_token_hash FROM sessions WHERE token_hash = ? AND expires_at > ?")
      .get(hashToken(sessionToken), new Date().toISOString()) as
      | { csrf_token_hash: string }
      | undefined;
    if (!row || !tokenMatches(row.csrf_token_hash, csrfToken)) {
      throw new AppError(403, "invalid_csrf", "Die Sicherheitsprüfung ist fehlgeschlagen.");
    }
  }

  logout(sessionToken: string | null): void {
    if (sessionToken) {
      this.database
        .prepare("DELETE FROM sessions WHERE token_hash = ?")
        .run(hashToken(sessionToken));
    }
  }

  createPasswordReset(userId: string): { expiresAt: string; token: string } {
    const userExists = this.database.prepare("SELECT 1 FROM users WHERE id = ?").get(userId);
    if (!userExists) {
      throw new AppError(404, "user_not_found", "Dieser Benutzer wurde nicht gefunden.");
    }
    const token = createOpaqueToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + passwordResetLifetimeMilliseconds).toISOString();
    inTransaction(this.database, () => {
      this.database
        .prepare("DELETE FROM password_reset_tokens WHERE expires_at <= ?")
        .run(now.toISOString());
      this.database.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(userId);
      this.database
        .prepare(
          `INSERT INTO password_reset_tokens
            (id, user_id, token_hash, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(randomUUID(), userId, hashToken(token), now.toISOString(), expiresAt);
    });
    return { expiresAt, token };
  }

  async resetPassword(token: unknown, passwordValue: unknown): Promise<void> {
    const password = validatePassword(passwordValue);
    if (typeof token !== "string" || !token || token.length > 200) {
      throw invalidPasswordReset();
    }
    const tokenHash = hashToken(token);
    const initial = this.database
      .prepare("SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND expires_at > ?")
      .get(tokenHash, new Date().toISOString()) as { user_id: string } | undefined;
    if (!initial) {
      throw invalidPasswordReset();
    }

    const passwordHash = await hashPassword(password);
    inTransaction(this.database, () => {
      const reset = this.database
        .prepare(
          "SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND expires_at > ?",
        )
        .get(tokenHash, new Date().toISOString()) as { user_id: string } | undefined;
      if (!reset || reset.user_id !== initial.user_id) {
        throw invalidPasswordReset();
      }
      const now = new Date().toISOString();
      this.database
        .prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
        .run(passwordHash, now, reset.user_id);
      this.database.prepare("DELETE FROM sessions WHERE user_id = ?").run(reset.user_id);
      this.database
        .prepare("DELETE FROM password_reset_tokens WHERE user_id = ?")
        .run(reset.user_id);
    });
  }

  private getUserById(userId: string): UserRow {
    const row = this.database.prepare(`${userQuery} WHERE u.id = ?`).get(userId) as
      | UserRow
      | undefined;
    if (!row) {
      throw new Error("Neu angelegter Benutzer konnte nicht geladen werden.");
    }
    return row;
  }

  private createSession(row: UserRow, now: string): SessionCredentials {
    const sessionToken = createOpaqueToken();
    const csrfToken = createOpaqueToken();
    const expiresAt = new Date(Date.parse(now) + sessionLifetimeMilliseconds).toISOString();
    this.database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    this.database
      .prepare(
        `INSERT INTO sessions
          (token_hash, csrf_token_hash, user_id, created_at, last_seen_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(hashToken(sessionToken), hashToken(csrfToken), row.id, now, now, expiresAt);

    return {
      csrfToken,
      expiresAt,
      sessionToken,
      user: toAuthenticatedUser(row, this.config.developmentOpenAiApiKey !== null),
    };
  }
}

const userQuery = `
  SELECT u.id, u.email, u.email_normalized, u.display_name, u.password_hash,
         u.openai_key_last_four, hm.household_id, h.name AS household_name
  FROM users u
  JOIN household_members hm ON hm.user_id = u.id
  JOIN households h ON h.id = hm.household_id
`;

function toAuthenticatedUser(row: UserRow, hasDevelopmentKey: boolean): AuthenticatedUser {
  return {
    displayName: row.display_name,
    email: row.email,
    householdId: row.household_id,
    householdName: row.household_name,
    id: row.id,
    openAiKeyMask: hasDevelopmentKey
      ? "Entwicklungsschlüssel"
      : row.openai_key_last_four
        ? `••••${row.openai_key_last_four}`
        : null,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

function invalidPasswordReset(): AppError {
  return new AppError(
    410,
    "password_reset_invalid",
    "Dieser Link ist ungültig oder bereits abgelaufen.",
  );
}
