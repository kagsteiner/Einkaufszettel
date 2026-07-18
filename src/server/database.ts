import { createHash } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

type MigrationRow = {
  version: number;
  name: string;
  checksum: string;
};

export type AppDatabase = DatabaseSync;
const activeTransactions = new WeakSet<AppDatabase>();

export async function openDatabase(
  databasePath: string,
  migrationDirectory = resolve("migrations"),
): Promise<AppDatabase> {
  if (databasePath !== ":memory:") {
    await mkdir(dirname(databasePath), { recursive: true, mode: 0o700 });
  }

  const database = new DatabaseSync(databasePath);
  try {
    database.exec(
      "PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;",
    );
    if (databasePath !== ":memory:") {
      database.exec("PRAGMA journal_mode = WAL;");
    }
    await applyMigrations(database, migrationDirectory);
    database.enableDefensive(true);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export async function applyMigrations(
  database: AppDatabase,
  migrationDirectory: string,
): Promise<void> {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const applied = new Map(
    (
      database
        .prepare("SELECT version, name, checksum FROM schema_migrations")
        .all() as MigrationRow[]
    ).map((migration) => [migration.version, migration]),
  );
  const migrationNames = (await readdir(migrationDirectory))
    .filter((name) => /^\d{3,}-[a-z0-9-]+\.sql$/.test(name))
    .sort();

  for (const name of migrationNames) {
    const version = Number(name.slice(0, name.indexOf("-")));
    const sql = await readFile(resolve(migrationDirectory, name), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = applied.get(version);

    if (existing) {
      if (existing.name !== name || existing.checksum !== checksum) {
        throw new Error(`Bereits angewendete Migration ${version} wurde nachträglich verändert.`);
      }
      continue;
    }

    inTransaction(database, () => {
      database.exec(sql);
      database
        .prepare(
          "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
        )
        .run(version, name, checksum, new Date().toISOString());
    });
  }
}

export function inTransaction<T>(database: AppDatabase, operation: () => T): T {
  if (activeTransactions.has(database)) {
    return operation();
  }
  database.exec("BEGIN IMMEDIATE");
  activeTransactions.add(database);
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    activeTransactions.delete(database);
  }
}
