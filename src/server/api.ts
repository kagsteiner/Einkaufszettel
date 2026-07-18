import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthService, SessionCredentials } from "./auth-service.ts";
import type { AppConfig } from "./config.ts";
import { AppError } from "./errors.ts";
import type { EventHub } from "./event-hub.ts";
import type { HouseholdService } from "./household-service.ts";
import { sendJson } from "./http.ts";
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
  eventHub: EventHub,
  config: AppConfig,
): Promise<boolean> {
  if (!pathname.startsWith("/api/")) {
    return false;
  }

  try {
    if (request.method === "POST" && pathname === "/api/auth/register") {
      assertSameOrigin(request, config);
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
          url: `${origin}/einladung/${encodeURIComponent(invitation.token)}`,
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

    const listMatch = pathname.match(/^\/api\/lists\/([^/]+)$/);
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

    const itemMatch = pathname.match(/^\/api\/items\/([^/]+)$/);
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
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    throw new AppError(415, "unsupported_media_type", "Erwartet wird application/json.");
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumJsonBytes) {
      throw new AppError(413, "body_too_large", "Die Anfrage ist zu groß.");
    }
    chunks.push(buffer);
  }

  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("object expected");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new AppError(400, "invalid_json", "Die Anfrage enthält kein gültiges JSON.");
  }
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
    "Path=/",
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
