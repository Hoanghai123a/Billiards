import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, relative } from "node:path";
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const distDir = join(root, "dist");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3300);
const pbUrl = new URL(process.env.PB_URL || "http://127.0.0.1:8390");
const proxyPrefix = "/api/public/pb";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function proxyPocketBase(request, response, path) {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    });
    response.end();
    return;
  }

  const target = new URL(path || "/", pbUrl);
  target.search = new URL(request.url, "http://localhost").search;
  const client = target.protocol === "https:" ? httpsRequest : httpRequest;
  const headers = { ...request.headers, host: target.host };
  delete headers.connection;

  const upstream = client(target, { method: request.method, headers }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", (error) => {
    if (!response.headersSent) sendJson(response, 502, { message: "PocketBase không kết nối được", error: error.message });
    else response.destroy(error);
  });
  request.pipe(upstream);
}

function safeStaticPath(urlPath) {
  const requested = decodeURIComponent(urlPath.split("?")[0] || "/");
  const candidate = normalize(join(distDir, requested));
  return relative(distDir, candidate).startsWith("..") ? null : candidate;
}

function serveStatic(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { message: "Phương thức không được hỗ trợ" });
    return;
  }
  const requested = safeStaticPath(request.url || "/");
  const filePath = requested && existsSync(requested) && statSync(requested).isFile() ? requested : join(distDir, "index.html");
  if (!existsSync(filePath)) {
    sendJson(response, 503, { message: "Frontend chưa được build" });
    return;
  }
  const relativePath = relative(distDir, filePath).replaceAll("\\", "/");
  const headers = {
    "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
    "Cache-Control": relativePath.startsWith("assets/")
      ? "public, max-age=31536000, immutable"
      : relativePath === "index.html" ? "no-cache" : "public, max-age=3600",
  };
  response.writeHead(200, headers);
  if (request.method === "HEAD") response.end();
  else createReadStream(filePath).pipe(response);
}

createServer((request, response) => {
  const requestUrl = new URL(request.url || "/", "http://localhost");
  if (requestUrl.pathname === proxyPrefix || requestUrl.pathname.startsWith(`${proxyPrefix}/`)) {
    proxyPocketBase(request, response, requestUrl.pathname.slice(proxyPrefix.length) || "/");
    return;
  }
  serveStatic(request, response);
}).listen(port, host, () => {
  console.log(`Billiard web server listening on http://${host}:${port}`);
  console.log(`PocketBase proxy target: ${pbUrl.origin}`);
});
