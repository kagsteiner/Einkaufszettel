import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "einkaufszettel-e2e-"));
process.env.APP_ENV = "test";
process.env.APP_ORIGIN = "http://127.0.0.1:3012";
process.env.DATABASE_PATH = resolve(temporaryDirectory, "e2e.db");
process.env.PORT = "3012";
process.env.UPLOAD_DIRECTORY = resolve(temporaryDirectory, "uploads");

await import("../src/server/main.ts");
