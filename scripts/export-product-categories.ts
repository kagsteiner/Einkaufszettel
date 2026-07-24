import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { exportProductCategoryKnowledge } from "./product-category-files.ts";

const options = parseOptions(process.argv.slice(2));
if (!options) {
  printUsage();
  process.exitCode = 2;
} else {
  const databasePath = resolve(options.database);
  const outputPath = resolve(options.output);
  const database = new Database(databasePath, { fileMustExist: true, readonly: true });
  try {
    const exported = exportProductCategoryKnowledge(database);
    await writeFile(outputPath, `${JSON.stringify(exported, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    console.info(`${exported.products.length} Produktzuordnungen nach ${outputPath} exportiert.`);
    if (exported.conflicts?.length) {
      console.warn(
        `${exported.conflicts.length} Konflikt(e) wurden getrennt aufgeführt und nicht als Produkte exportiert.`,
      );
    }
  } finally {
    database.close();
  }
}

function parseOptions(values: string[]): { database: string; output: string } | null {
  let database: string | undefined;
  let output: string | undefined;
  for (let index = 0; index < values.length; index += 2) {
    const value = values[index + 1];
    if (!value) {
      return null;
    }
    if (values[index] === "--database") {
      database = value;
    } else if (values[index] === "--output") {
      output = value;
    } else {
      return null;
    }
  }
  return database && output ? { database, output } : null;
}

function printUsage(): void {
  console.info(`Produktwissen aus einer Datenbank exportieren:
  npm run categories:export -- --database <datenbank.db> --output <export.json>`);
}
