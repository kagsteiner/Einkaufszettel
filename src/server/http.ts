import type { Stats } from "node:fs";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

const contentTypes: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
};

export function applySecurityHeaders(response: ServerResponse, production = false): void {
  response.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data: blob:",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
    ].join("; "),
  );
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  if (production) {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(serialized),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(serialized);
}

export async function servePublicFile(
  request: IncomingMessage,
  response: ServerResponse,
  publicDirectory: string,
  pathname: string,
): Promise<boolean> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }

  const requestedPath = resolve(publicDirectory, `.${pathname}`);
  if (requestedPath !== publicDirectory && !requestedPath.startsWith(`${publicDirectory}${sep}`)) {
    return false;
  }

  let fileStats: Stats;
  try {
    fileStats = await stat(requestedPath);
  } catch {
    return false;
  }
  if (!fileStats.isFile()) {
    return false;
  }

  const extension = extname(requestedPath).toLowerCase();
  const isHashedAsset = pathname.startsWith("/assets/");
  const cacheControl = isHashedAsset
    ? "public, max-age=31536000, immutable"
    : pathname === "/manifest.webmanifest"
      ? "public, max-age=0, must-revalidate"
      : "no-store";
  response.writeHead(200, {
    "Cache-Control": cacheControl,
    "Content-Length": fileStats.size,
    "Content-Type": contentTypes[extension] || "application/octet-stream",
  });

  if (request.method === "HEAD") {
    response.end();
    return true;
  }
  createReadStream(requestedPath).pipe(response);
  return true;
}

export async function serveAppShell(
  request: IncomingMessage,
  response: ServerResponse,
  publicDirectory: string,
): Promise<void> {
  if (request.method !== "GET") {
    sendJson(response, 404, { error: "Nicht gefunden" });
    return;
  }
  const html = await readFile(resolve(publicDirectory, "index.html"));
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Length": html.length,
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(html);
}
