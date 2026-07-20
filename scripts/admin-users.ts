import { unlink } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { AdminService, type AdminUser } from "../src/server/admin-service.ts";
import { loadConfig } from "../src/server/config.ts";
import { openDatabase } from "../src/server/database.ts";

const config = loadConfig();
const database = await openDatabase(config.databasePath);
const adminService = new AdminService(database);

try {
  console.info(`Datenbank: ${config.databasePath}`);
  const [command, identifier, option, confirmation] = process.argv.slice(2);
  if (command === "list" && !identifier) {
    printUsers(adminService.listUsers());
  } else if (command === "delete" && identifier) {
    const user = adminService.findUser(identifier);
    printUsers([user]);
    const confirmed =
      option === "--confirm" ? confirmation === user.email : await confirmInteractively(user.email);
    if (!confirmed) {
      throw new Error(
        `Löschen nicht bestätigt. Erwartet wurde die exakte E-Mail-Adresse: ${user.email}`,
      );
    }

    const deleted = adminService.deleteUser(user.id);
    const failedImages: string[] = [];
    for (const storageName of deleted.orphanedImageStorageNames) {
      if (basename(storageName) !== storageName) {
        console.warn(`Unsicherer Bildpfad wurde nicht entfernt: ${storageName}`);
        failedImages.push(storageName);
        continue;
      }
      await unlink(resolve(config.uploadDirectory, storageName)).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn(`Verwaiste Bilddatei konnte nicht entfernt werden: ${storageName}`);
          failedImages.push(storageName);
        }
      });
    }
    if (failedImages.length > 0) {
      throw new Error(
        `Das Konto wurde gelöscht, aber ${failedImages.length} Bilddatei(en) müssen manuell entfernt werden.`,
      );
    }
    console.info(`Benutzer ${deleted.email} (${deleted.id}) wurde vollständig gelöscht.`);
  } else {
    printUsage();
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Admin-Befehl fehlgeschlagen.");
  process.exitCode = 1;
} finally {
  database.close();
}

function printUsers(users: ReadonlyArray<AdminUser>): void {
  if (users.length === 0) {
    console.info("Keine Benutzer vorhanden.");
    return;
  }
  console.table(
    users.map((user) => ({
      E_Mail: user.email,
      Haushalt: user.householdName,
      ID: user.id,
      Listen: user.listCount,
      Mitglieder: user.memberCount,
      Name: user.displayName,
      Registriert: user.createdAt,
    })),
  );
}

async function confirmInteractively(email: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`Ohne interaktives Terminal ist --confirm "${email}" erforderlich.`);
  }
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await input.question(
      `WARNUNG: Konto und persönliche Daten werden unwiderruflich gelöscht.\nZur Bestätigung exakte E-Mail eingeben (${email}): `,
    );
    return answer === email;
  } finally {
    input.close();
  }
}

function printUsage(): void {
  console.info(`Benutzerverwaltung:
  npm run admin:users -- list
  npm run admin:users -- delete <E-Mail-oder-ID>
  npm run admin:users -- delete <E-Mail-oder-ID> --confirm <exakte-E-Mail>`);
}
