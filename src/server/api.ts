import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthService, SessionCredentials } from "./auth-service.ts";
import type { AppConfig } from "./config.ts";
import { AppError } from "./errors.ts";
import type { EventHub } from "./event-hub.ts";
import type { HouseholdService } from "./household-service.ts";
import { sendJson } from "./http.ts";
import type { ImageService } from "./image-service.ts";
import { maximumImageBytes } from "./image-service.ts";
import type { RateLimiter } from "./rate-limiter.ts";
import type { RecipeService } from "./recipe-service.ts";
import type { SettingsService } from "./settings-service.ts";
import type { ShoppingService } from "./shopping-service.ts";

const sessionCookieName = "zettel_session";
const csrfCookieName = "zettel_csrf";
const maximumJsonBytes = 32 * 1_024;

export async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  authService: AuthService,
  householdService: HouseholdService,
  shoppingService: ShoppingService,
  settingsService: SettingsService,
  imageService: ImageService,
  recipeService: RecipeService,
  eventHub: EventHub,
  rateLimiter: RateLimiter,
  config: AppConfig,
): Promise<boolean> {
  if (!pathname.startsWith("/api/")) {
    return false;
  }

  try {
    if (request.method === "POST" && pathname === "/api/auth/register") {
      assertSameOrigin(request, config);
      rateLimiter.consume(`auth:${clientAddress(request, config)}`, 10, 15 * 60 * 1_000);
      const body = await readJson(request);
      const credentials = await authService.register({
        displayName: body.displayName,
        email: body.email,
        password: body.password,
      });
      setSessionCookies(response, credentials, config);
      sendJson(response, 201, { user: credentials.user });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/auth/login") {
      assertSameOrigin(request, config);
      rateLimiter.consume(`auth:${clientAddress(request, config)}`, 10, 15 * 60 * 1_000);
      const body = await readJson(request);
      const credentials = await authService.login({ email: body.email, password: body.password });
      setSessionCookies(response, credentials, config);
      sendJson(response, 200, { user: credentials.user });
      return true;
    }

    const cookies = parseCookies(request.headers.cookie);
    const sessionToken = cookies.get(sessionCookieName) || null;

    if (request.method === "GET" && pathname === "/api/session") {
      const user = authService.authenticate(sessionToken);
      sendJson(response, 200, { user });
      return true;
    }

    if (request.method === "GET" && pathname === "/api/state") {
      const user = authService.authenticate(sessionToken);
      sendJson(response, 200, shoppingService.getState(user));
      return true;
    }

    if (request.method === "GET" && pathname === "/api/events") {
      const user = authService.authenticate(sessionToken);
      eventHub.subscribe(user.householdId, request, response);
      return true;
    }

    const imageMatch = pathname.match(/^\/api\/images\/([^/]+)$/);
    if (request.method === "GET" && imageMatch?.[1]) {
      const user = authService.authenticate(sessionToken);
      const image = await imageService.readImage(user, imageMatch[1]);
      response.writeHead(200, {
        "Cache-Control": "private, no-store",
        "Content-Length": image.buffer.length,
        "Content-Type": image.mimeType,
      });
      response.end(image.buffer);
      return true;
    }

    if (request.method === "POST" && pathname === "/api/auth/logout") {
      assertSameOrigin(request, config);
      authService.verifyCsrf(sessionToken, request.headers["x-csrf-token"]?.toString() || null);
      authService.logout(sessionToken);
      clearSessionCookies(response, config);
      sendJson(response, 200, { ok: true });
      return true;
    }

    const invitationMatch = pathname.match(/^\/api\/invitations\/([^/]+)$/);
    if (request.method === "GET" && invitationMatch?.[1]) {
      const user = authService.authenticate(sessionToken);
      sendJson(response, 200, {
        invitation: householdService.previewInvitation(user, invitationMatch[1]),
      });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/invitations") {
      assertSameOrigin(request, config);
      authService.verifyCsrf(sessionToken, request.headers["x-csrf-token"]?.toString() || null);
      const user = authService.authenticate(sessionToken);
      const body = await readJson(request);
      const invitation = householdService.createInvitation(user, body.email);
      const origin =
        config.origin || `http://${request.headers.host || `localhost:${config.port}`}`;
      sendJson(response, 201, {
        invitation: {
          expiresAt: invitation.expiresAt,
          url: `${origin}${config.basePath}/einladung/${encodeURIComponent(invitation.token)}`,
        },
      });
      return true;
    }

    const acceptMatch = pathname.match(/^\/api\/invitations\/([^/]+)\/accept$/);
    if (request.method === "POST" && acceptMatch?.[1]) {
      assertSameOrigin(request, config);
      authService.verifyCsrf(sessionToken, request.headers["x-csrf-token"]?.toString() || null);
      const user = authService.authenticate(sessionToken);
      const body = await readJson(request);
      const household = householdService.acceptInvitation(
        user,
        acceptMatch[1],
        body.moveExistingData === true,
      );
      eventHub.publish(household.householdId);
      sendJson(response, 200, { household });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/lists") {
      const user = authenticateWrite(request, authService, sessionToken, config);
      const body = await readJson(request);
      const list = shoppingService.createList(user, body.name);
      eventHub.publish(user.householdId);
      sendJson(response, 201, { list });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/images") {
      const user = authenticateWrite(request, authService, sessionToken, config);
      rateLimiter.consume(`upload:${user.id}`, 60, 60 * 60 * 1_000);
      const contentType = requestContentType(request);
      const image = await imageService.storeImage(
        user,
        await readRequestBody(request, maximumImageBytes),
        contentType,
      );
      sendJson(response, 201, { image });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/ai/recipe-analysis") {
      const user = authenticateWrite(request, authService, sessionToken, config);
      rateLimiter.consume(`ai:${user.id}`, 20, 60 * 60 * 1_000);
      const analysis = await recipeService.analyzeRecipe(
        user,
        await readRequestBody(request, maximumImageBytes),
        requestContentType(request),
      );
      sendJson(response, 200, { analysis });
      return true;
    }

    if (request.method === "PATCH" && pathname === "/api/settings/profile") {
      const user = authenticateWrite(request, authService, sessionToken, config);
      const body = await readJson(request);
      const profile = settingsService.updateDisplayName(user, body.displayName);
      eventHub.publish(user.householdId);
      sendJson(response, 200, { profile });
      return true;
    }

    if (request.method === "PUT" && pathname === "/api/settings/openai-key") {
      const user = authenticateWrite(request, authService, sessionToken, config);
      const body = await readJson(request);
      const openAiKey = settingsService.saveOpenAiApiKey(user, body.apiKey);
      sendJson(response, 200, { openAiKey });
      return true;
    }

    if (request.method === "DELETE" && pathname === "/api/settings/openai-key") {
      const user = authenticateWrite(request, authService, sessionToken, config);
      settingsService.deleteOpenAiApiKey(user);
      response.writeHead(204, { "Cache-Control": "no-store" });
      response.end();
      return true;
    }

    const recurringItemsMatch = pathname.match(/^\/api\/lists\/([^/]+)\/recurring-items$/);
    if (request.method === "GET" && recurringItemsMatch?.[1]) {
      const user = authService.authenticate(sessionToken);
      const suggestions = shoppingService.getRecurringSuggestions(user, recurringItemsMatch[1]);
      sendJson(response, 200, { suggestions });
      return true;
    }
    if (request.method === "POST" && recurringItemsMatch?.[1]) {
      const user = authenticateWrite(request, authService, sessionToken, config);
      const body = await readJson(request);
      const items = shoppingService.addRecurringItems(user, recurringItemsMatch[1], body.items);
      eventHub.publish(user.householdId);
      sendJson(response, 200, { items });
      return true;
    }

    const listMatch = pathname.match(/^\/api\/lists\/([^/]+)$/);
    if (request.method === "PATCH" && listMatch?.[1]) {
      const user = authenticateWrite(request, authService, sessionToken, config);
      const body = await readJson(request);
      const list = shoppingService.updateList(user, listMatch[1], body.name);
      eventHub.publish(user.householdId);
      sendJson(response, 200, { list });
      return true;
    }

    const listImageMatch = pathname.match(/^\/api\/lists\/([^/]+)\/image$/);
    if (request.method === "PUT" && listImageMatch?.[1]) {
      const user = authenticateWrite(request, authService, sessionToken, config);
      const body = await readJson(request);
      shoppingService.setListImage(user, listImageMatch[1], body.imageId);
      eventHub.publish(user.householdId);
      sendJson(response, 200, { ok: true });
      return true;
    }

    const recipeItemsMatch = pathname.match(/^\/api\/lists\/([^/]+)\/recipe-items$/);
    if (request.method === "POST" && recipeItemsMatch?.[1]) {
      const user = authenticateWrite(request, authService, sessionToken, config);
      const body = await readJson(request);
      const results = shoppingService.addRecipeItems(user, recipeItemsMatch[1], body.items);
      eventHub.publish(user.householdId);
      sendJson(response, 200, { results });
      return true;
    }
    if (request.method === "DELETE" && listMatch?.[1]) {
      const user = authenticateWrite(request, authService, sessionToken, config);
      shoppingService.deleteList(user, listMatch[1]);
      eventHub.publish(user.householdId);
      response.writeHead(204, { "Cache-Control": "no-store" });
      response.end();
      return true;
    }

    const listItemsMatch = pathname.match(/^\/api\/lists\/([^/]+)\/items$/);
    if (request.method === "POST" && listItemsMatch?.[1]) {
      const user = authenticateWrite(request, authService, sessionToken, config);
      const body = await readJson(request);
      const result = shoppingService.addItem(user, listItemsMatch[1], {
        category: body.category,
        name: body.name,
        note: body.note,
        quantities: body.quantities,
      });
      eventHub.publish(user.householdId);
      sendJson(response, result.merge === "created" ? 201 : 200, result);
      return true;
    }

    const itemCompletedMatch = pathname.match(/^\/api\/items\/([^/]+)\/completed$/);
    if (request.method === "PUT" && itemCompletedMatch?.[1]) {
      const user = authenticateWrite(request, authService, sessionToken, config);
      const body = await readJson(request);
      if (typeof body.completed !== "boolean") {
        throw new AppError(400, "invalid_input", "Der Erledigt-Status ist ungültig.");
      }
      const item = shoppingService.setCompleted(user, itemCompletedMatch[1], body.completed);
      eventHub.publish(user.householdId);
      sendJson(response, 200, { item });
      return true;
    }

    const itemImageMatch = pathname.match(/^\/api\/items\/([^/]+)\/image$/);
    if (request.method === "PUT" && itemImageMatch?.[1]) {
      const user = authenticateWrite(request, authService, sessionToken, config);
      const body = await readJson(request);
      const item = shoppingService.setItemImage(user, itemImageMatch[1], body.imageId);
      eventHub.publish(user.householdId);
      sendJson(response, 200, { item });
      return true;
    }

    const itemMatch = pathname.match(/^\/api\/items\/([^/]+)$/);
    if (request.method === "PATCH" && itemMatch?.[1]) {
      const user = authenticateWrite(request, authService, sessionToken, config);
      const body = await readJson(request);
      const item = shoppingService.updateItem(user, itemMatch[1], {
        category: body.category,
        name: body.name,
        note: body.note,
        quantities: body.quantities,
      });
      eventHub.publish(user.householdId);
      sendJson(response, 200, { item });
      return true;
    }
    if (request.method === "DELETE" && itemMatch?.[1]) {
      const user = authenticateWrite(request, authService, sessionToken, config);
      shoppingService.deleteItem(user, itemMatch[1]);
      eventHub.publish(user.householdId);
      response.writeHead(204, { "Cache-Control": "no-store" });
      response.end();
      return true;
    }

    if (request.method === "POST" && pathname === "/api/pantry") {
      const user = authenticateWrite(request, authService, sessionToken, config);
      const body = await readJson(request);
      const item = shoppingService.addPantryItem(user, body.name);
      eventHub.publish(user.householdId);
      sendJson(response, 201, { item });
      return true;
    }

    const pantryMatch = pathname.match(/^\/api\/pantry\/([^/]+)$/);
    if (request.method === "DELETE" && pantryMatch?.[1]) {
      const user = authenticateWrite(request, authService, sessionToken, config);
      shoppingService.deletePantryItem(user, pantryMatch[1]);
      eventHub.publish(user.householdId);
      response.writeHead(204, { "Cache-Control": "no-store" });
      response.end();
      return true;
    }

    sendJson(response, 404, { error: { code: "not_found", message: "Nicht gefunden" } });
    return true;
  } catch (error) {
    if (error instanceof AppError) {
      sendJson(response, error.status, { error: { code: error.code, message: error.message } });
      return true;
    }
    throw error;
  }
}

function authenticateWrite(
  request: IncomingMessage,
  authService: AuthService,
  sessionToken: string | null,
  config: AppConfig,
) {
  assertSameOrigin(request, config);
  authService.verifyCsrf(sessionToken, request.headers["x-csrf-token"]?.toString() || null);
  return authService.authenticate(sessionToken);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = requestContentType(request);
  if (contentType !== "application/json") {
    throw new AppError(415, "unsupported_media_type", "Erwartet wird application/json.");
  }

  try {
    const value = JSON.parse(
      (await readRequestBody(request, maximumJsonBytes)).toString("utf8"),
    ) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("object expected");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new AppError(400, "invalid_json", "Die Anfrage enthält kein gültiges JSON.");
  }
}

async function readRequestBody(request: IncomingMessage, maximumBytes: number): Promise<Buffer> {
  const declaredLength = Number(request.headers["content-length"] || "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new AppError(413, "body_too_large", "Die Anfrage ist zu groß.");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumBytes) {
      throw new AppError(413, "body_too_large", "Die Anfrage ist zu groß.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function requestContentType(request: IncomingMessage): string {
  return request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() || "";
}

function clientAddress(request: IncomingMessage, config: AppConfig): string {
  if (config.trustProxy) {
    const forwarded = request.headers["x-forwarded-for"]?.toString().split(",", 1)[0]?.trim();
    if (forwarded) {
      return forwarded;
    }
  }
  return request.socket.remoteAddress || "unknown";
}

function assertSameOrigin(request: IncomingMessage, config: AppConfig): void {
  const origin = request.headers.origin;
  const expectedOrigin =
    config.origin || `http://${request.headers.host || `localhost:${config.port}`}`;
  if (origin !== expectedOrigin) {
    throw new AppError(403, "invalid_origin", "Die Herkunft der Anfrage ist nicht erlaubt.");
  }
}

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of header?.split(";") || []) {
    const separator = part.indexOf("=");
    if (separator < 1) {
      continue;
    }
    try {
      cookies.set(
        part.slice(0, separator).trim(),
        decodeURIComponent(part.slice(separator + 1).trim()),
      );
    } catch {
      // Ignore malformed cookie values instead of rejecting an otherwise valid request.
    }
  }
  return cookies;
}

function setSessionCookies(
  response: ServerResponse,
  credentials: SessionCredentials,
  config: AppConfig,
): void {
  const maxAge = Math.max(0, Math.floor((Date.parse(credentials.expiresAt) - Date.now()) / 1_000));
  response.setHeader("Set-Cookie", [
    serializeCookie(sessionCookieName, credentials.sessionToken, maxAge, true, config),
    serializeCookie(csrfCookieName, credentials.csrfToken, maxAge, false, config),
  ]);
}

function clearSessionCookies(response: ServerResponse, config: AppConfig): void {
  response.setHeader("Set-Cookie", [
    serializeCookie(sessionCookieName, "", 0, true, config),
    serializeCookie(csrfCookieName, "", 0, false, config),
  ]);
}

function serializeCookie(
  name: string,
  value: string,
  maxAge: number,
  httpOnly: boolean,
  config: AppConfig,
): string {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${config.basePath || "/"}`,
    `Max-Age=${maxAge}`,
    httpOnly ? "SameSite=Lax" : "SameSite=Strict",
  ];
  if (httpOnly) {
    attributes.push("HttpOnly");
  }
  if (config.appEnvironment === "production") {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}
