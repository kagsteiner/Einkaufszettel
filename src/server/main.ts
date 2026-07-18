import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./database.ts";
import { applySecurityHeaders, sendJson, serveAppShell, servePublicFile } from "./http.ts";

const config = loadConfig();
const database = await openDatabase(config.databasePath);
const versionFile = resolve(config.publicDirectory, "version.json");
let buildVersion = "unknown";

try {
  const versionDocument = JSON.parse(await readFile(versionFile, "utf8")) as { version?: unknown };
  if (typeof versionDocument.version === "string") {
    buildVersion = versionDocument.version;
  }
} catch {
  // Health checks remain available if the client has not been built yet.
}

const server = createServer(async (request, response) => {
  applySecurityHeaders(response);

  try {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname === "/api/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }
    if (url.pathname === "/api/version") {
      sendJson(response, 200, { version: buildVersion });
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: "Nicht gefunden" });
      return;
    }
    if (await servePublicFile(request, response, config.publicDirectory, url.pathname)) {
      return;
    }
    await serveAppShell(request, response, config.publicDirectory);
  } catch (error) {
    console.error(
      "Unbehandelter Serverfehler",
      error instanceof Error ? error.message : "unbekannt",
    );
    if (!response.headersSent) {
      sendJson(response, 500, { error: "Interner Serverfehler" });
    } else {
      response.destroy();
    }
  }
});

server.listen(config.port, () => {
  console.info(`Einkaufszettel läuft auf Port ${config.port} (${config.appEnvironment}).`);
});

function shutdown(): void {
  server.close((error) => {
    database.close();
    process.exitCode = error ? 1 : 0;
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
