import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { handleApiRequest } from "./api.ts";
import { AuthService } from "./auth-service.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./database.ts";
import { EventHub } from "./event-hub.ts";
import { HouseholdService } from "./household-service.ts";
import { applySecurityHeaders, sendJson, serveAppShell, servePublicFile } from "./http.ts";
import { ImageService } from "./image-service.ts";
import { RateLimiter } from "./rate-limiter.ts";
import { RecipeService } from "./recipe-service.ts";
import { SettingsService } from "./settings-service.ts";
import { ShoppingService } from "./shopping-service.ts";

const config = loadConfig();
const database = await openDatabase(config.databasePath);
const authService = new AuthService(database, config);
const householdService = new HouseholdService(database);
const shoppingService = new ShoppingService(database);
const settingsService = new SettingsService(database, config);
const imageService = new ImageService(database, config);
const recipeService = new RecipeService(database, imageService, settingsService);
const eventHub = new EventHub();
const rateLimiter = new RateLimiter();
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
  applySecurityHeaders(response, config.appEnvironment === "production");

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
    if (
      await handleApiRequest(
        request,
        response,
        url.pathname,
        authService,
        householdService,
        shoppingService,
        settingsService,
        imageService,
        recipeService,
        eventHub,
        rateLimiter,
        config,
      )
    ) {
      return;
    }
    if (await servePublicFile(request, response, config.publicDirectory, url.pathname)) {
      return;
    }
    await serveAppShell(request, response, config.publicDirectory, config.basePath);
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

let shuttingDown = false;

function shutdown(): void {
  if (shuttingDown) {
    process.exit(130);
  }
  shuttingDown = true;
  eventHub.close();
  server.close((error) => {
    database.close();
    process.exitCode = error ? 1 : 0;
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
