import { randomUUID } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { ProductImageBacklog } from "../src/server/product-image-backlog.ts";

const values = process.argv.slice(2);
const options = new Map<string, string>();
for (let index = 0; index < values.length; index += 2) {
  const key = values[index];
  const value = values[index + 1];
  if (!key || !value || !["--database", "--output", "--public"].includes(key) || options.has(key)) {
    throw new Error("Erwartet: --database <db> --output <json> [--public <public-Verzeichnis>]");
  }
  options.set(key, value);
}
if (!options.has("--database") || !options.has("--output")) {
  throw new Error("Erwartet: --database <db> --output <json> [--public <public-Verzeichnis>]");
}
const database = new Database(resolve(options.get("--database") as string), {
  readonly: true,
  fileMustExist: true,
});
try {
  const backlog = new ProductImageBacklog(
    database,
    resolve(options.get("--public") || "dist/public"),
  );
  const exported = backlog.export();
  const output = resolve(options.get("--output") as string);
  const temporary = `${output}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(exported, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, output);
  console.info(`${exported.products.length} Bildwünsche exportiert.`);
} finally {
  database.close();
}
