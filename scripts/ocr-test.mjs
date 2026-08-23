import fs from "node:fs";

const CARD_PATH = process.argv[2] || "C:\\Users\\<redacted>\\Music\\карты\\bmo_card_10.png";

const form = new FormData();
form.append("apikey", process.env.OCR_API_KEYS.split(",")[0].trim());
form.append("language", "rus");
form.append("OCREngine", "2");
form.append("scale", "true");
form.append("isOverlayRequired", "true");
form.append("file", new Blob([fs.readFileSync(CARD_PATH)]), "card.png");

const r = await fetch("https://api.ocr.space/parse/image", { method: "POST", body: form });
console.log("HTTP", r.status);
const d = await r.json();

if (d.IsErroredOnProcessing) {
  console.error(d.ErrorMessage || d.ErrorDetails);
  process.exit(1);
}

const res = d.ParsedResults[0];
console.log("--- Полный текст ---");
console.log(res.ParsedText);

console.log("\n--- Координаты строк (Left, Top, W x H) ---");
const lines = (res.TextOverlay?.Lines || [])
  .slice()
  .sort((a, b) => a.MinTop - b.MinTop || a.Words[0]?.Left - b.Words[0]?.Left);
for (const line of lines) {
  const w = line.Words[0] || {};
  const text = line.Words.map((x) => x.WordText).join(" ");
  console.log(
    `[${String(w.Left).padStart(4)} , ${String(w.Top).padStart(4)}] ${String(w.Width).padStart(3)} x ${String(w.Height).padStart(3)}  "${text}"`
  );
}
