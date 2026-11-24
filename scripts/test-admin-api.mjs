import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

async function getFreePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => socket.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}

const tempDir = await mkdtemp(path.join(tmpdir(), "auto-razbor-admin-test-"));
const catalogFile = path.join(tempDir, "catalog.json");
const port = await getFreePort();
const password = "ci-" + randomBytes(24).toString("hex");
const sessionSecret = randomBytes(48).toString("base64url");
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: process.cwd(),
  stdio: "ignore",
  env: {
    ...process.env,
    PORT: String(port),
    BOT_TOKEN: "",
    ADMIN_PASSWORD: password,
    ADMIN_SESSION_SECRET: sessionSecret,
    CATALOG_FILE: catalogFile,
    CORS_ALLOWED_ORIGINS: "https://kapusta1a.github.io",
    ENABLE_TELEGRAM_MENU_BUTTON: "false",
    ENABLE_TELEGRAM_WEBHOOK: "false"
  }
});

try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error("Server exited before becoming ready");
    try {
      const health = await fetch(baseUrl + "/health");
      if (health.ok) { ready = true; break; }
    } catch {}
    await delay(250);
  }
  assert.equal(ready, true, "Server should become healthy");

  const initialCatalogResponse = await fetch(baseUrl + "/api/catalog", {
    headers: { origin: "https://kapusta1a.github.io" }
  });
  assert.equal(initialCatalogResponse.status, 200, "An empty mounted catalog should initialize from the seed");
  const initialCatalog = await initialCatalogResponse.json();
  assert.ok(initialCatalog.brands.length > 0, "Seed catalog should be copied to the persistent path");
  assert.ok((await readFile(catalogFile, "utf8")).length > 0, "CATALOG_FILE should be initialized on first read");

  const sessionBefore = await fetch(baseUrl + "/api/admin/session").then(r => r.json());
  assert.equal(sessionBefore.configured, true);
  assert.equal(sessionBefore.authenticated, false);

  const unauthorized = await fetch(baseUrl + "/api/admin/catalog");
  assert.equal(unauthorized.status, 401, "Admin catalog must require a session");

  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password })
  });
  assert.equal(login.status, 200, "Admin login should succeed");
  const setCookie = login.headers.get("set-cookie") || "";
  assert.match(setCookie, /ar_admin=/, "Login should issue the admin session cookie");
  const cookie = setCookie.split(";")[0];

  const adminCatalogResponse = await fetch(baseUrl + "/api/admin/catalog", {
    headers: { cookie }
  });
  assert.equal(adminCatalogResponse.status, 200);
  const catalog = await adminCatalogResponse.json();
  const testId = "ci-admin-test-" + Date.now();
  catalog.brands.push({ id: testId, name: "CI Test Record", country: "CI", models: [] });

  const save = await fetch(baseUrl + "/api/admin/catalog", {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(catalog)
  });
  assert.equal(save.status, 200, "Admin catalog save should succeed");
  assert.equal((await save.json()).ok, true);

  const origin = "https://kapusta1a.github.io";
  const publicResponse = await fetch(baseUrl + "/api/catalog", {
    headers: { origin }
  });
  assert.equal(publicResponse.status, 200);
  assert.equal(publicResponse.headers.get("access-control-allow-origin"), origin);
  const publicCatalog = await publicResponse.json();
  assert.ok(publicCatalog.brands.some(brand => brand.id === testId), "Public catalog should expose the saved record");

  const savedOnDisk = JSON.parse(await readFile(catalogFile, "utf8"));
  assert.ok(savedOnDisk.brands.some(brand => brand.id === testId), "Catalog should be persisted to CATALOG_FILE");

  const preflight = await fetch(baseUrl + "/api/telegram/auth", {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type"
    }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), origin);

  const blockedOrigin = await fetch(baseUrl + "/api/catalog", {
    headers: { origin: "https://not-allowed.example" }
  });
  assert.equal(blockedOrigin.headers.get("access-control-allow-origin"), null, "Unknown origins must not receive CORS access");

  const logout = await fetch(baseUrl + "/api/admin/logout", {
    method: "POST",
    headers: { cookie }
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie") || "", /Max-Age=0/);

  console.log("Admin API integration test passed: login, session, protected read, save, CATALOG_FILE persistence and CORS.");
} finally {
  child.kill("SIGTERM");
  await new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(resolve, 2000);
  });
  await rm(tempDir, { recursive: true, force: true });
}
