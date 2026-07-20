import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { AuthService } from "../src/server/auth-service.ts";
import { loadConfig } from "../src/server/config.ts";
import type { AppDatabase } from "../src/server/database.ts";
import { openDatabase } from "../src/server/database.ts";
import { hashToken } from "../src/server/security.ts";

let authService: AuthService;
let database: AppDatabase;

before(async () => {
  database = await openDatabase(":memory:");
  authService = new AuthService(
    database,
    loadConfig({ APP_ENV: "test", DATABASE_PATH: ":memory:", PORT: "3000" }),
  );
});

after(() => database.close());

test("registration creates a personal household and a hashed session", async () => {
  const credentials = await authService.register({
    displayName: "  Anna   Beispiel ",
    email: " Anna@Example.COM ",
    password: "ein sicheres Passwort",
  });

  assert.equal(credentials.user.displayName, "Anna Beispiel");
  assert.equal(credentials.user.email, "Anna@Example.COM");
  assert.equal(credentials.user.householdName, "Mein Haushalt");
  assert.equal(authService.authenticate(credentials.sessionToken).id, credentials.user.id);

  const storedUser = database
    .prepare("SELECT password_hash FROM users WHERE id = ?")
    .get(credentials.user.id) as { password_hash: string };
  assert.notEqual(storedUser.password_hash, "ein sicheres Passwort");
  assert.equal(
    (
      database
        .prepare("SELECT count(*) AS count FROM sessions WHERE token_hash = ?")
        .get(hashToken(credentials.sessionToken)) as { count: number }
    ).count,
    1,
  );
  assert.equal(
    (
      database
        .prepare("SELECT count(*) AS count FROM sessions WHERE token_hash = ?")
        .get(credentials.sessionToken) as { count: number }
    ).count,
    0,
  );
});

test("login and CSRF checks reject invalid credentials", async () => {
  const loggedIn = await authService.login({
    email: "anna@example.com",
    password: "ein sicheres Passwort",
  });
  assert.equal(loggedIn.user.displayName, "Anna Beispiel");
  assert.doesNotThrow(() => authService.verifyCsrf(loggedIn.sessionToken, loggedIn.csrfToken));
  assert.throws(() => authService.verifyCsrf(loggedIn.sessionToken, "wrong"), /Sicherheitsprüfung/);
  await assert.rejects(
    authService.login({ email: "anna@example.com", password: "falsch" }),
    /nicht korrekt/,
  );
});

test("a one-time password reset changes the password and invalidates all sessions", async () => {
  const user = database
    .prepare("SELECT id FROM users WHERE email_normalized = ?")
    .get("anna@example.com") as { id: string };
  const existingSession = await authService.login({
    email: "anna@example.com",
    password: "ein sicheres Passwort",
  });
  const replacedReset = authService.createPasswordReset(user.id);
  const reset = authService.createPasswordReset(user.id);

  assert.equal(
    (
      database
        .prepare("SELECT count(*) AS count FROM password_reset_tokens WHERE token_hash = ?")
        .get(hashToken(reset.token)) as { count: number }
    ).count,
    1,
  );
  assert.equal(
    (
      database
        .prepare("SELECT count(*) AS count FROM password_reset_tokens WHERE token_hash = ?")
        .get(reset.token) as { count: number }
    ).count,
    0,
  );
  await assert.rejects(
    authService.resetPassword(replacedReset.token, "ein ganz neues Passwort"),
    /ungültig oder bereits abgelaufen/,
  );

  await authService.resetPassword(reset.token, "ein ganz neues Passwort");

  assert.throws(
    () => authService.authenticate(existingSession.sessionToken),
    /Bitte melde dich an/,
  );
  await assert.rejects(
    authService.login({ email: "anna@example.com", password: "ein sicheres Passwort" }),
    /nicht korrekt/,
  );
  await assert.doesNotReject(
    authService.login({ email: "anna@example.com", password: "ein ganz neues Passwort" }),
  );
  await assert.rejects(
    authService.resetPassword(reset.token, "noch ein neues Passwort"),
    /ungültig oder bereits abgelaufen/,
  );
});

test("email uniqueness is case-independent", async () => {
  await assert.rejects(
    authService.register({
      displayName: "Andere Anna",
      email: "ANNA@example.com",
      password: "noch ein sicheres Passwort",
    }),
    /bereits ein Konto/,
  );
});
