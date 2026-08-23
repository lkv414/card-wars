import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const INPUT_DIR = process.env.OCR_INPUT_DIR;
const OUTPUT_CSV = process.env.OCR_OUTPUT_CSV;

const KEYS = (process.env.OCR_API_KEYS || "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

if (!INPUT_DIR || !OUTPUT_CSV || KEYS.length === 0) {
  console.error(
    "Нужны переменные окружения: OCR_INPUT_DIR, OCR_OUTPUT_CSV, OCR_API_KEYS (ключи через запятую)"
  );
  process.exit(1);
}

const API_URL = "https://api.ocr.space/parse/image";
const RATE_LIMIT_MS = 1000; // пауза между запросами
const MAX_RETRIES = 3;

let keyIndex = 0;
function nextKey() {
  const key = KEYS[keyIndex % KEYS.length];
  keyIndex++;
  return key;
}

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n\r;]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function normalizeText(text) {
  return (text || "").replace(/\s+/g, " ").trim().toLowerCase();
}

// Простая метрика схожести для поиска дубликатов по распознанному тексту
function similarity(a, b) {
  if (!a || !b) return 0;
  const setA = new Set(a.split(" "));
  const setB = new Set(b.split(" "));
  let common = 0;
  for (const w of setA) if (setB.has(w)) common++;
  return common / Math.max(setA.size, setB.size);
}

async function ocrFile(filePath, retries = MAX_RETRIES) {
  const key = nextKey();
  const form = new FormData();
  form.append("apikey", key);
  form.append("language", "rus");
  form.append("OCREngine", "2");
  form.append("scale", "true");
  form.append("isTable", "true");
  form.append("file", new Blob([fs.readFileSync(filePath)]), path.basename(filePath));

  try {
    const res = await fetch(API_URL, { method: "POST", body: form });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    if (data.IsErroredOnProcessing) {
      throw new Error(data.ErrorDetails || "OCR error");
    }
    // Может вернуться массив результатов — берём первый
    const parsed = Array.isArray(data.ParsedResults)
      ? data.ParsedResults[0]?.ParsedText || ""
      : "";
    return parsed;
  } catch (err) {
    if (retries > 0) {
      console.warn(`⚠ ${path.basename(filePath)}: ${err.message}, повтор (${MAX_RETRIES - retries + 1}/${MAX_RETRIES}), след. ключ`);
      await sleep(RATE_LIMIT_MS * 2);
      return ocrFile(filePath, retries - 1);
    }
    throw err;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const files = fs
    .readdirSync(INPUT_DIR)
    .filter((f) => /\.png$/i.test(f))
    .sort();

  console.log(`Найдено файлов: ${files.length}`);

  // Результаты предыдущих запусков — чтобы продолжить с места остановки
  const done = new Map(); // file -> { text, md5, duplicateOf }
  if (fs.existsSync(OUTPUT_CSV)) {
    const lines = fs.readFileSync(OUTPUT_CSV, "utf8").split("\n").slice(1);
    for (const line of lines) {
      if (!line.trim()) continue;
      const cols = [];
      let cur = "", inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = !inQ;
        } else if (ch === "," && !inQ) { cols.push(cur); cur = ""; }
        else cur += ch;
      }
      cols.push(cur);
      if (cols[0]) done.set(cols[0], { text: normalizeText(cols[1]), md5: cols[5], duplicateOf: cols[6] });
    }
    console.log(`Уже обработано ранее: ${done.size}, пропускаю их`);
  }

  const records = [...done.entries()].map(([file, r]) => ({
    file,
    text: r.text,
    md5: r.md5,
    duplicateOf: r.duplicateOf || "",
  }));

  for (const file of files) {
    if (done.has(file)) continue;

    const filePath = path.join(INPUT_DIR, file);
    const md5 = crypto.createHash("md5").update(fs.readFileSync(filePath)).digest("hex");

    let text = "";
    try {
      text = await ocrFile(filePath);
    } catch (err) {
      console.error(`✗ ${file}: ${err.message} — записываю пустой результат`);
    }

    // Определяем дубликат: точный (по md5 файла) или неточный (текст похож >= 0.9)
    let duplicateOf = "";
    if (!text) {
      const same = records.find((r) => r.md5 === md5);
      if (same) duplicateOf = same.file;
    } else {
      const norm = normalizeText(text);
      const similar = records.find((r) => r.text && similarity(norm, r.text) >= 0.9);
      if (similar) duplicateOf = similar.file;
    }

    const rec = { file, text: normalizeText(text), md5, duplicateOf };
    records.push(rec);
    done.set(file, rec);

    appendCsv(rec);
    console.log(
      `✓ ${file}${rec.duplicateOf ? ` (дубликат ${rec.duplicateOf})` : ""}`
    );

    await sleep(RATE_LIMIT_MS);
  }

  rewriteCsv(records);
  console.log(`Готово. Всего записей: ${records.length}`);
}

function toCsvLine(r) {
  return [
    csvEscape(r.file),
    csvEscape(r.text),
    csvEscape(r.duplicateOf ? "" : r.text), // unique_text — только уникальные карты
    csvEscape(r.duplicateOf),
    csvEscape(r.md5),
  ].join(",");
}

const CSV_HEADER =
  "filename,ocr_text,unique_text,duplicate_of,file_md5";

function appendCsv(rec) {
  const isNew = !fs.existsSync(OUTPUT_CSV);
  fs.mkdirSync(path.dirname(OUTPUT_CSV), { recursive: true });
  fs.appendFileSync(
    OUTPUT_CSV,
    (isNew ? CSV_HEADER + "\n" : "") + toCsvLine(rec) + "\n",
    "utf8"
  );
}

function rewriteCsv(records) {
  fs.mkdirSync(path.dirname(OUTPUT_CSV), { recursive: true });
  fs.writeFileSync(
    OUTPUT_CSV,
    [CSV_HEADER, ...records.map(toCsvLine)].join("\n") + "\n",
    "utf8"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
