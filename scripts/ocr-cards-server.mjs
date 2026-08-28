/**
 * ocr-cards-server.mjs — локальный веб-интерфейс для разметки карт из папки.
 *
 * Слой поверх scripts/ocr-cards.mjs: использует тот же ocr.space API с
 * круговым перебором 4 ключей (OCR_API_KEYS). Дополнительно парсит сырой
 * OCR-текст в поля карты (эвристика) и сохраняет результат в JSON.
 *
 * Запуск:
 *   OCR_API_KEYS="k1,k2,k3,k4" node scripts/ocr-cards-server.mjs
 *   опционально: OCR_INPUT_DIR, OCR_OUTPUT_JSON, PORT
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import https from "node:https";

/* Загрузка .env (без зависимостей). Переменные из окружения имеют приоритет. */
function loadDotEnv() {
  const envPath = path.resolve(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
loadDotEnv();

/* Прокси: если задана HTTPS_PROXY/HTTP_PROXY — крупные POST идут через
   CONNECT-туннель (иначе корпоративный прокси может сбрасывать соединение). */
const PROXY_URL =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  "";

const INPUT_DIR = path.resolve(ROOT, process.env.OCR_INPUT_DIR || "исходники/карты");
const OUTPUT_JSON = path.resolve(ROOT, process.env.OCR_OUTPUT_JSON || "исходники/cards.json");
const PORT = Number(process.env.PORT || 5174);

const KEYS = (process.env.OCR_API_KEYS || "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

// MiniMax (MiniMax) Anthropic-compatible endpoint — основной fallback
let MINIMAX_KEY = process.env.MINIMAX_API_KEY || "";
if (!MINIMAX_KEY) {
  for (const p of [
    "<user>/AppData/Local/hermes/keys/minimax.env",
    path.resolve(ROOT, "minimax.env"),
  ]) {
    try {
      const txt = fs.readFileSync(p, "utf8");
      const m = txt.match(/^\s*MINIMAX_API_KEY\s*=\s*(.+)\s*$/m);
      if (m) { MINIMAX_KEY = m[1].trim().replace(/^["']|["']$/g, ""); break; }
    } catch {}
  }
}
const MINIMAX_MODEL = process.env.MINIMAX_MODEL || "MiniMax-M3";
const MINIMAX_URL = process.env.MINIMAX_BASE_URL || "https://api.minimax.io/anthropic/v1/messages";

const API_URL = process.env.OCR_API_BASE || "https://api.ocr.space/parse/image";

let keyIndex = 0;
function nextKey() {
  const key = KEYS[keyIndex % KEYS.length];
  keyIndex += 1;
  return key;
}

/* --------------------------- OCR (ocr.space) --------------------------- */
let ocrCallCount = 0;
async function ocrBuffer(buffer, filename) {
  const key = nextKey();
  const keyPos = (keyIndex - 1) % KEYS.length;
  const callId = ++ocrCallCount;
  console.log(`[ocr #${callId}] ▶ ${filename} | ключ #${keyPos} | ${API_URL}`);

  // Прогрессивное сжатие: сброс соединения (ECONNRESET) на крупных телах —
  // типичное ограничение сети/прокси. Уменьшаем и повторяем, пока не пройдёт.
  const levels = [
    { dim: 1400, q: 82 },
    { dim: 1000, q: 70 },
    { dim: 800, q: 60 },
    { dim: 600, q: 50 },
  ];
  let lastErr;
  for (let i = 0; i < levels.length; i++) {
    const { dim, q } = levels[i];
    let outBuffer = buffer;
    let contentType = "image/png";
    let outName = filename;
    try {
      const sharp = (await import("sharp")).default;
      const img = sharp(buffer);
      const meta = await img.metadata();
      if ((meta.width || 0) > dim || (meta.height || 0) > dim) {
        img.resize(dim, dim, { fit: "inside" });
      }
      outBuffer = await img.jpeg({ quality: q }).toBuffer();
      contentType = "image/jpeg";
      outName = filename.replace(/\.[^.]+$/, ".jpg");
    } catch (e) {
      if (i === 0) console.warn(`[ocr #${callId}] ⚠ сжатие недоступно, шлю оригинал`);
    }
    console.log(`[ocr #${callId}] попытка ${i + 1}: ${outBuffer.length} байт`);
    try {
      return await postMultipart(outBuffer, outName, contentType, key, callId);
    } catch (e) {
      lastErr = e;
      const cause = e.cause ? ` (${e.cause.code || e.cause.message})` : "";
      console.warn(`[ocr #${callId}] ✗ ${outBuffer.length} байт: ${e.message}${cause} — уменьшаем`);
    }
  }
  throw lastErr || new Error("не удалось отправить");
}

function postMultipart(buffer, filename, contentType, key, callId) {
  const u = new URL(API_URL);
  const boundary = "----ocrbnd" + Date.now().toString(36);
  const fields = [
    ["apikey", key],
    ["language", "rus"],
    ["OCREngine", "2"],
    ["scale", "true"],
    ["isTable", "true"],
  ];
  let head = "";
  for (const [k, v] of fields) {
    head += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
  }
  head += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const payload = Buffer.concat([
    Buffer.from(head, "utf8"),
    buffer,
    Buffer.from(tail, "utf8"),
  ]);
  const headers = {
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
    "Content-Length": payload.length,
    Connection: "close",
  };
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const onResponse = (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const status = res.statusCode;
        console.log(`[ocr #${callId}] ◀ ответ ${status} за ${Date.now() - started}мс`);
        if (status !== 200) {
          reject(new Error(`HTTP ${status}`));
          return;
        }
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (data.IsErroredOnProcessing) {
            reject(new Error(data.ErrorDetails || "OCR error"));
            return;
          }
          const parsed = Array.isArray(data.ParsedResults)
            ? data.ParsedResults[0]?.ParsedText || ""
            : "";
          console.log(`[ocr #${callId}] ✓ распознано символов: ${parsed.length}`);
          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      });
    };
    const onError = (e) => {
      const cause = e.cause
        ? ` | cause: ${e.cause.code || e.cause.message || e.cause}`
        : "";
      console.error(`[ocr #${callId}] ✗ ${e.message}${cause}`);
      reject(e);
    };

    const makeRequest = (socketOpts) => {
      const req = https.request(
        {
          host: u.hostname,
          port: u.port || 443,
          path: u.pathname + u.search,
          method: "POST",
          headers,
          servername: u.hostname,
          ...socketOpts,
        },
        onResponse
      );
      req.on("error", onError);
      req.write(payload);
      req.end();
    };

    if (PROXY_URL) {
      const p = new URL(PROXY_URL);
      const tunnel = http.request({
        host: p.hostname,
        port: p.port || 80,
        method: "CONNECT",
        path: `${u.hostname}:${u.port || 443}`,
      });
      tunnel.on("connect", (r, socket) => {
        if (r.statusCode !== 200) {
          reject(new Error(`прокси CONNECT вернул ${r.statusCode}`));
          return;
        }
        makeRequest({ socket, agent: false });
      });
      tunnel.on("error", onError);
      tunnel.end();
    } else {
      makeRequest({});
    }
  });
}

/* ---------------------- Эвристический парсинг -------------------------- */
const LAND_KEYWORDS = [
  ["corn", ["кукуруз"]],
  ["ice", ["лед"]],
  ["good", ["добр"]],
  ["swamp", ["болот"]],
  ["sand", ["пустын"]],
  ["blue", ["син"]],
  ["any", ["радуж"]],
];
const TYPE_KEYWORDS = [
  ["spell", ["заклинан", "spell"]],
  ["building", ["строен", "building"]],
  ["creature", ["существо", "creature"]],
];

function detectLandType(text) {
  const t = text.toLowerCase();
  for (const [type, kws] of LAND_KEYWORDS) if (kws.some((k) => t.includes(k))) return type;
  return "";
}
function detectCardType(text) {
  const t = text.toLowerCase();
  for (const [type, kws] of TYPE_KEYWORDS) if (kws.some((k) => t.includes(k))) return type;
  return "";
}
function numOnLine(text, kws) {
  for (const line of text.split("\n")) {
    if (kws.some((k) => line.toLowerCase().includes(k))) {
      const m = line.match(/-?\d+/);
      if (m) return Number(m[0]);
    }
  }
  return null;
}

function parseCardText(text, filename) {
  const lines = String(text || "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const name =
    lines.find((l) => /[a-zA-Zа-яА-ЯёЁ]/.test(l) && !/^-?\d+$/.test(l)) || "";

  const m = String(filename || "").match(/(\d+)/);
  const cardNumber = m ? m[1] : "";

  return {
    id: cardNumber ? `BMO_${cardNumber}` : "",
    card_number: cardNumber,
    name,
    description: lines.filter((l) => l !== name).join("\n").trim(),
    card_type: detectCardType(text),
    cost: numOnLine(text, ["цена", "cost", "стоимость", "mana"]) ?? "",
    attack: numOnLine(text, ["атака", "attack", "сила"]) ?? "",
    health: numOnLine(text, ["здоров", "health", "жизн"]) ?? "",
    land_type: detectLandType(text),
    is_rainbow: /радуж|rainbow/.test(text.toLowerCase()),
    has_flip: false,
    flip_description: "",
    mechanics: "",
    hero: "",
    source: "bmo",
    image_url: `исходники/карты/${filename}`,
  };
}

/* --------------------- MiniMax (Anthropic-compatible) ----------------- */
const MINIMAX_PROMPT = `Ты распознаёшь карту из коллекционной карточной игры Adventure Time Card Wars на русском.

Верни ТОЛЬКО валидный JSON (без markdown-обёрток \`\`\`) с такими полями:
{
  "name_en": "<английское название сверху мелким>",
  "name_ru": "<русское название крупно>",
  "type": "существо" | "заклинание" | "здание" | "особая",
  "cost": <число слева сверху>,
  "faction": "rainbow" | "plains" | "forest" | "swamp" | "sky" | "undead" | "donut" | "cosmic" | "slime" | "princess" | "candy",
  "ability_title": "<подзаголовок способности>",
  "ability_text": "<полный русский текст способности>",
  "attack": <число слева снизу или null>,
  "health": <число справа снизу или null>,
  "set_id": "<код внизу типа CP1/CP2/CP6/FCP>"
}
Если поля нет — null. Не выдумывай.`;

async function minimaxAnalyze(buffer) {
  if (!MINIMAX_KEY) throw new Error("MINIMAX_API_KEY не задан");
  const b64 = buffer.toString("base64");
  const payload = {
    model: MINIMAX_MODEL,
    max_tokens: 800,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
        { type: "text", text: MINIMAX_PROMPT }
      ]
    }]
  };
  const body = JSON.stringify(payload);
  const urlObj = new URL(MINIMAX_URL);
  const opts = {
    host: urlObj.hostname,
    port: urlObj.port || 443,
    path: urlObj.pathname + urlObj.search,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "Authorization": `Bearer ${MINIMAX_KEY}`,
      "anthropic-version": "2023-06-01",
    },
  };
  return await new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const status = res.statusCode;
        const txt = Buffer.concat(chunks).toString("utf8");
        if (status !== 200) {
          let msg = `HTTP ${status}`;
          try { const j = JSON.parse(txt); msg = j.error?.message || j.message || msg; } catch {}
          reject(new Error(`MiniMax: ${msg}`));
          return;
        }
        try {
          const data = JSON.parse(txt);
          const content = Array.isArray(data.content)
            ? data.content.filter(c => c.type === "text").map(c => c.text).join("\n")
            : "";
          resolve(content);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/* Извлекает JSON-блок из текста (даже если модель обернула в markdown). */
function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const raw = fenced ? fenced[1] : text;
  // выдёргиваем первый { ... } блок
  const m = raw.match(/\{[\s\S]*}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
function parseJsonFields(text, filename) {
  const obj = extractJson(text) || {};
  const num = (v) => (v == null || v === "" || v === "null") ? "" : (Number(v) || 0);
  const str = (v) => (v == null || v === "null") ? "" : String(v);
  // id и card_number берём из имени файла (как в parseCardText)
  const fnum = String(filename || "").match(/(\d+)/);
  return {
    id: fnum ? `BMO_${fnum[1]}` : "",
    card_number: fnum ? fnum[1] : "",
    name: str(obj.name_ru ?? obj.name),
    description: str(obj.ability_text),
    card_type: str(obj.type),
    cost: num(obj.cost),
    attack: num(obj.attack),
    health: num(obj.health),
    land_type: str(obj.faction),
    is_rainbow: /^радуж|rainbow/i.test(str(obj.faction)) || str(obj.faction) === "rainbow",
    has_flip: false,
    flip_description: "",
    mechanics: str(obj.ability_title),
    hero: "",
    source: "bmo",
    image_url: `исходники/карты/${filename}`,
  };
}

/* ----------------------------- State JSON ------------------------------ */
function loadState() {
  if (!fs.existsSync(OUTPUT_JSON)) return {};
  try {
    return JSON.parse(fs.readFileSync(OUTPUT_JSON, "utf8"));
  } catch {
    return {};
  }
}
function saveState(state) {
  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(state, null, 2), "utf8");
}

/* Ключ карты: "<name>" + "#" + "<card_number>".
   Если нет ни name, ни card_number — fallback на filename (старое поведение). */
function makeCardKey(fields, filename) {
  const name = (fields.name || fields.name_ru || "").trim();
  const num = (fields.card_number || "").toString().trim();
  if (name && num) return `${name}#${num}`;
  if (name) return name;
  if (num) return `#${num}`;
  return `file:${filename}`;
}

/* Обратный индекс filename → cardKey, чтобы помечать карты как «размечено»,
   даже если их сохраняли под другим именем файла (image_urls). */
function indexStateByFiles(state) {
  const map = {};
  for (const [cardKey, rec] of Object.entries(state)) {
    const urls = rec.image_urls || (rec.image_url ? [rec.image_url] : (rec.filename ? [`исходники/карты/${rec.filename}`] : []));
    for (const url of urls) {
      const base = path.basename(url);
      if (base) map[base] = cardKey;
    }
  }
  return map;
}

function listFiles() {
  if (!fs.existsSync(INPUT_DIR)) return [];
  return fs
    .readdirSync(INPUT_DIR)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .sort();
}

/* ------------------------------- HTTP ---------------------------------- */
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        const cleaned = data.replace(/^﻿/, "").trim();
        resolve(cleaned ? JSON.parse(cleaned) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const UI_HTML = path.join(__dirname, "ocr-cards-ui.html");

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = url.pathname;

    // UI
    if (p === "/" || p === "/index.html") {
      if (!fs.existsSync(UI_HTML)) {
        res.writeHead(404);
        res.end("UI file not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      fs.createReadStream(UI_HTML).pipe(res);
      return;
    }

    // Image proxy
    if (p === "/image") {
      const file = url.searchParams.get("file") || "";
      const safe = path.basename(file);
      const full = path.join(INPUT_DIR, safe);
      if (!fs.existsSync(full)) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "image/png" });
      fs.createReadStream(full).pipe(res);
      return;
    }

    if (p === "/api/cards" && req.method === "GET") {
      const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
      const limit = Math.min(64, Number(url.searchParams.get("limit") || 8));
      const all = listFiles();
      const page = all.slice(offset, offset + limit);
      const state = loadState();
      // Обратный индекс: filename → cardKey (для пометки «размечено»,
      // даже если имя файла изменилось, но карта та же)
      const fileToKey = indexStateByFiles(state);
      sendJson(res, 200, {
        items: page.map((filename, i) => ({
          index: offset + i,
          filename,
          url: `/image?file=${encodeURIComponent(filename)}`,
          saved: state[fileToKey[filename]] || null,
          cardKey: fileToKey[filename] || null,
        })),
        total: all.length,
        offset,
        limit,
        keysConfigured: KEYS.length,
      });
      return;
    }

    if (p === "/api/analyze" && req.method === "POST") {
      const { filename } = await readBody(req);
      const safe = path.basename(filename || "");
      const full = path.join(INPUT_DIR, safe);
      if (!fs.existsSync(full)) {
        sendJson(res, 404, { error: "файл не найден" });
        return;
      }
      const buffer = fs.readFileSync(full);
      console.log(`[analyze] запрос на ${safe} (${buffer.length} байт)`);

      // Сначала MiniMax (приоритет), потом OCR.space как fallback
      const provider = (process.env.OCR_PROVIDER || "auto").toLowerCase();
      let textOut = "";
      let fieldsOut = null;
      const errors = [];

      const tryMinimax = MINIMAX_KEY && (provider === "auto" || provider === "minimax" || provider === "minimax");
      if (tryMinimax) {
        try {
          textOut = await minimaxAnalyze(buffer);
          fieldsOut = parseJsonFields(textOut, safe);
          console.log(`[analyze] ✓ MiniMax: ${textOut.length} chars`);
        } catch (e) {
          console.warn(`[analyze] ✗ MiniMax: ${e.message}`);
          errors.push(`minimax: ${e.message}`);
        }
      }

      if (!fieldsOut && provider !== "minimax" && KEYS.length > 0) {
        try {
          textOut = await ocrBuffer(buffer, safe);
          fieldsOut = parseCardText(textOut, safe);
          console.log(`[analyze] ✓ OCR.space: ${textOut.length} chars`);
        } catch (e) {
          console.error(`[analyze] ✗ OCR.space: ${e.message}`);
          errors.push(`ocr.space: ${e.message}`);
        }
      }

      if (!fieldsOut) {
        const all = errors.length ? errors.join("; ") : "ни один провайдер не сработал";
        sendJson(res, 502, { error: `OCR не удался: ${all}` });
        return;
      }
      sendJson(res, 200, {
        filename: safe,
        ocrText: textOut,
        fields: fieldsOut,
      });
      return;
    }

    if (p === "/api/save" && req.method === "POST") {
      const body = await readBody(req);
      const filename = path.basename(body.filename || "");
      if (!filename) {
        sendJson(res, 400, { error: "filename обязателен" });
        return;
      }
      const state = loadState();
      // Ключ карты = name_ru || name + "#" + card_number
      // Если нет ни name, ни card_number — fallback на filename (старое поведение)
      const cardKey = makeCardKey(body.fields || {}, filename);
      const prev = state[cardKey] || {};
      // Сохраняем карту + добавляем filename в image_urls (без дублей)
      const imageUrls = Array.from(new Set([
        ...(prev.image_urls || [prev.image_url].filter(Boolean)),
        `исходники/карты/${filename}`,
      ]));
      // Берём все поля из body + cardKey + reviewed + image_urls, мерджим с prev
      const merged = { ...prev, ...body.fields, cardKey, reviewed: true, image_urls: imageUrls };
      // filename оставляем только один (самый последний сохранённый)
      merged.filename = filename;
      state[cardKey] = merged;
      saveState(state);
      sendJson(res, 200, { ok: true, cardKey, filename });
      return;
    }

    if (p === "/api/state" && req.method === "GET") {
      sendJson(res, 200, loadState());
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`OCR Cards UI: http://localhost:${PORT}`);
  console.log(`Источник: ${INPUT_DIR}`);
  console.log(`Ключей MiniMax: ${MINIMAX_KEY ? "1 (приоритет)" : "0"}`);
  console.log(`Ключей ocr.space: ${KEYS.length} (fallback)`);
  console.log(`Вывод JSON: ${OUTPUT_JSON}`);
});
