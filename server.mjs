import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const PUBLIC_URL = (process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
const WEBAPP_URL = process.env.WEBAPP_URL || PUBLIC_URL;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const MAX_AGE = Number(process.env.INIT_DATA_MAX_AGE || 86400);

const CORS_ALLOWED_ORIGINS = new Set(
  (process.env.CORS_ALLOWED_ORIGINS || "https://kapusta1a.github.io")
    .split(",").map(origin => origin.trim().replace(/\\/$/, "")).filter(Boolean)
);
function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  const normalized = origin.replace(/\\/$/, "");
  if (normalized !== PUBLIC_URL && !CORS_ALLOWED_ORIGINS.has(normalized)) return;
  res.setHeader("Access-Control-Allow-Origin", normalized);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
}

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || "";
const ADMIN_SESSION_TTL = 8 * 60 * 60;
const adminLoginAttempts = new Map();

function signAdminSession(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", ADMIN_SESSION_SECRET).update(data).digest("base64url");
  return data + "." + signature;
}
function validAdminSession(req) {
  if (!ADMIN_SESSION_SECRET) return false;
  const cookie = (req.headers.cookie || "").split(";").map(v => v.trim()).find(v => v.startsWith("ar_admin="));
  if (!cookie) return false;
  const token = cookie.slice("ar_admin=".length);
  const [data, signature] = token.split(".");
  if (!data || !signature) return false;
  const expected = crypto.createHmac("sha256", ADMIN_SESSION_SECRET).update(data).digest();
  let actual;
  try { actual = Buffer.from(signature, "base64url"); } catch { return false; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    return payload.role === "admin" && Number.isFinite(payload.exp) && payload.exp > Date.now() / 1000;
  } catch { return false; }
}
function adminCookie(req, value, maxAge) {
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return "ar_admin=" + value + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=" + maxAge + secure;
}
function requireAdmin(req, res) {
  if (validAdminSession(req)) return true;
  json(res, 401, { error: "Требуется вход администратора" });
  return false;
}
function validateCatalogForSave(catalog) {
  if (!catalog || ![1, 2].includes(catalog.schemaVersion) || !Array.isArray(catalog.brands)) return "Неверный формат каталога";
  if (catalog.brands.length > 1000) return "Слишком много марок";
  const ids = new Set();
  const check = (item, type) => {
    if (!item || typeof item.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id)) return type + ": неверный ID";
    if (ids.has(item.id)) return "Повторяется ID: " + item.id;
    ids.add(item.id);
    return "";
  };
  for (const brand of catalog.brands) {
    const error = check(brand, "Марка");
    if (error) return error;
    if (!brand.name || !brand.country || !Array.isArray(brand.models)) return "У марки нужны название, страна и список моделей";
    for (const model of brand.models) {
      const error = check(model, "Модель");
      if (error) return error;
      if (!model.name || !Array.isArray(model.generations)) return "У модели нужны название и список поколений";
      for (const gen of model.generations) {
        const error = check(gen, "Поколение");
        if (error) return error;
        if (!gen.code || !gen.years || !Array.isArray(gen.markets)) return "У поколения нужны код, годы и список рынков";
        if (gen.images != null && !Array.isArray(gen.images)) return "Фотографии должны быть списком";
        if (gen.specifications != null && !Array.isArray(gen.specifications)) return "Характеристики должны быть списком";
      }
    }
  }
  return "";
}
async function saveAdminCatalog(catalog) {
  const error = validateCatalogForSave(catalog);
  if (error) throw new Error(error);
  const target = path.resolve(process.env.CATALOG_FILE || path.join(ROOT, "data/catalog.seed.json"));
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const temp = target + ".tmp";
  await fs.promises.writeFile(temp, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  await fs.promises.rename(temp, target);
}


const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

async function readBody(req, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function validateInitData(initData) {
  if (!BOT_TOKEN || typeof initData !== "string" || !initData) return null;
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) return null;
  params.delete("hash");
  params.delete("signature");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const expected = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest();
  const actual = Buffer.from(receivedHash, "hex");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || authDate > Date.now() / 1000 + 60 || Date.now() / 1000 - authDate > MAX_AGE) return null;
  try {
    const user = JSON.parse(params.get("user") || "null");
    if (!user || !Number.isSafeInteger(user.id)) return null;
    return { id: user.id, first_name: user.first_name || "", username: user.username || null, auth_date: authDate };
  } catch {
    return null;
  }
}

async function telegram(method, payload) {
  if (!BOT_TOKEN) throw new Error("BOT_TOKEN is not configured");
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram API error: ${method}`);
  return result.result;
}

async function handleWebhook(req, res) {
  if (!WEBHOOK_SECRET || req.headers["x-telegram-bot-api-secret-token"] !== WEBHOOK_SECRET) {
    return json(res, 403, { ok: false });
  }
  const update = JSON.parse(await readBody(req));
  const message = update.message;
  const chatId = message?.chat?.id;
  const text = message?.text || "";
  if (chatId && /^\/start(?:\s|$)/.test(text)) {
    const keyboard = WEBAPP_URL ? { inline_keyboard: [[{ text: "🚘 Открыть AUTO_RAZBOR", web_app: { url: WEBAPP_URL } }]] } : undefined;
    await telegram("sendMessage", {
      chat_id: chatId,
      text: "Добро пожаловать в AUTO_RAZBOR! Автомобильная энциклопедия: марки, модели, поколения и характеристики.",
      ...(keyboard ? { reply_markup: keyboard } : {})
    });
  } else if (chatId && text === "/help") {
    await telegram("sendMessage", { chat_id: chatId, text: "Нажмите кнопку «Открыть AUTO_RAZBOR» в меню бота или отправьте /start." });
  }
  json(res, 200, { ok: true });
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const file = path.resolve(ROOT, "public", "." + requested);
  const base = path.resolve(ROOT, "public");
  if (!file.startsWith(base + path.sep)) return json(res, 403, { error: "Forbidden" });
  try {
    const body = await fs.promises.readFile(file);
    const ext = path.extname(file);
    const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };
    res.writeHead(200, { "content-type": types[ext] || "application/octet-stream", "x-content-type-options": "nosniff" });
    res.end(body);
  } catch {
    json(res, 404, { error: "Not found" });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    applyCors(req, res);
    if (req.method === "OPTIONS") { res.writeHead(204, { "cache-control": "no-store" }); return res.end(); }
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, app: "AUTO_RAZBOR" });
    if (req.method === "GET" && url.pathname === "/api/catalog") {
      const catalogPath = path.resolve(process.env.CATALOG_FILE || path.join(ROOT, "data/catalog.seed.json"));
      const catalog = JSON.parse(await fs.promises.readFile(catalogPath, "utf8"));
      return json(res, 200, catalog);
    }
    if (req.method === "POST" && url.pathname === "/api/admin/login") {
      if (!ADMIN_PASSWORD || !ADMIN_SESSION_SECRET) return json(res, 503, { error: "Админ-доступ не настроен на сервере" });
      const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
      const attempt = adminLoginAttempts.get(ip) || { count: 0, until: 0 };
      if (attempt.until > Date.now() && attempt.count >= 8) return json(res, 429, { error: "Слишком много попыток. Попробуйте через 15 минут." });
      const body = JSON.parse(await readBody(req, 8 * 1024));
      const supplied = Buffer.from(String(body.password || ""));
      const expected = Buffer.from(ADMIN_PASSWORD);
      const valid = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
      if (!valid) {
        const next = attempt.until > Date.now() ? attempt : { count: 0, until: Date.now() + 15 * 60 * 1000 };
        next.count++;
        adminLoginAttempts.set(ip, next);
        return json(res, 401, { error: "Неверный пароль" });
      }
      adminLoginAttempts.delete(ip);
      const token = signAdminSession({ role: "admin", exp: Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL });
      res.setHeader("Set-Cookie", adminCookie(req, token, ADMIN_SESSION_TTL));
      return json(res, 200, { ok: true, expiresIn: ADMIN_SESSION_TTL });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/logout") {
      res.setHeader("Set-Cookie", adminCookie(req, "", 0));
      return json(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/api/admin/session") {
      return json(res, 200, { authenticated: validAdminSession(req), configured: Boolean(ADMIN_PASSWORD && ADMIN_SESSION_SECRET) });
    }
    if (req.method === "GET" && url.pathname === "/api/admin/catalog") {
      if (!requireAdmin(req, res)) return;
      const target = path.resolve(process.env.CATALOG_FILE || path.join(ROOT, "data/catalog.seed.json"));
      const catalog = JSON.parse(await fs.promises.readFile(target, "utf8"));
      return json(res, 200, catalog);
    }
    if (req.method === "PUT" && url.pathname === "/api/admin/catalog") {
      if (!requireAdmin(req, res)) return;
      const body = JSON.parse(await readBody(req, 12 * 1024 * 1024));
      await saveAdminCatalog(body);
      return json(res, 200, { ok: true, brands: body.brands.length });
    }
    if (req.method === "POST" && url.pathname === "/api/telegram/auth") {
      const body = JSON.parse(await readBody(req, 32 * 1024));
      const user = validateInitData(body.initData);
      return user ? json(res, 200, { ok: true, user }) : json(res, 401, { ok: false, error: "Invalid Telegram initData" });
    }
    if (req.method === "POST" && url.pathname === "/webhook") return await handleWebhook(req, res);
    if (req.method === "GET") return await serveStatic(req, res, url.pathname);
    json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    json(res, 400, { error: error.message || "Bad request" });
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`AUTO_RAZBOR listening on :${PORT}`));

async function configureTelegram() {
  if (!BOT_TOKEN) {
    console.log("BOT_TOKEN missing: running in preview mode; Telegram API setup is disabled.");
    return;
  }

  // Telegram allows only one active webhook per bot. Never replace an existing
  // webhook merely because the service restarted or was redeployed.
  if (process.env.ENABLE_TELEGRAM_MENU_BUTTON === "true") {
    if (!WEBAPP_URL) throw new Error("WEBAPP_URL is required to configure the Mini App menu button");
    await telegram("setChatMenuButton", {
      menu_button: { type: "web_app", text: "AUTO_RAZBOR", web_app: { url: WEBAPP_URL } }
    });
    console.log("Telegram Mini App menu button configured.");
  }

  // Webhook changes are deliberately opt-in and must be enabled only after
  // the current bot host and its commands have been migrated and verified.
  if (process.env.ENABLE_TELEGRAM_WEBHOOK === "true") {
    const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL || (PUBLIC_URL ? `${PUBLIC_URL}/webhook` : "");
    if (!webhookUrl || !WEBHOOK_SECRET) {
      throw new Error("TELEGRAM_WEBHOOK_URL (or RENDER_EXTERNAL_URL) and TELEGRAM_WEBHOOK_SECRET are required");
    }
    await telegram("setWebhook", {
      url: webhookUrl,
      secret_token: WEBHOOK_SECRET,
      allowed_updates: ["message", "pre_checkout_query"]
    });
    console.log("Telegram webhook configured by explicit opt-in.");
  }
}
configureTelegram().catch(error => console.error("Telegram setup failed:", error.message));
