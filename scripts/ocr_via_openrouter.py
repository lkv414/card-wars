"""
ocr_via_openrouter.py — массовый OCR через OpenRouter Vision.
Использует модель nvidia/nemotron-nano-12b-v2-vl:free.

Запуск:
  python scripts/ocr_via_openrouter.py [--start 0] [--limit 640] [--batch-size 10]

Записывает результаты в БД через ocr_all_cards.py.
"""
import os, sys, re, json, base64, time, argparse, subprocess
from pathlib import Path
import urllib.request

ROOT = r"C:\Users\<redacted>\WebstormProjects\card_game"
TMP_DIR = Path(r"C:\Users\<redacted>\AppData\Local\Temp\card_ocr")
MANIFEST = TMP_DIR / "manifest.json"
OR_ENV = r"C:\Users\<redacted>\AppData\Local\hermes\keys\openrouter.env"
DB_PATH = r"C:\Users\<redacted>\WebstormProjects\card_game\data\cards.db"
OCR_SCRIPT = r"C:\Users\<redacted>\WebstormProjects\card_game\scripts\ocr_all_cards.py"

PROMPT = """This is a Card Wars trading card. Read it CAREFULLY and return ONLY this JSON:
{"name":"Russian name as printed exactly","card_type":"creature|spell|building|landscape","cost":N,"attack":N,"health":N,"land_type":"blue|corn|good|ice|sand|swamp|rainbow|any","is_rainbow":true|false,"has_flip":true|false,"flip_description":"text or null","description":"FULL Russian ability text or null"}
Be precise with numbers. Return ONLY the JSON object, no other text."""


def get_key():
    with open(OR_ENV, encoding="utf-8") as f:
        m = re.search(r"OPENROUTER_API_KEY=(\S+)", f.read())
    if not m:
        raise RuntimeError("OPENROUTER_API_KEY not found in " + OR_ENV)
    return m.group(1)


def ocr_card(img_path, key):
    b64 = base64.b64encode(Path(img_path).read_bytes()).decode("ascii")
    body = {
        "model": "nvidia/nemotron-nano-12b-v2-vl:free",
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": PROMPT},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}}
            ]
        }],
        "max_tokens": 800,
        "temperature": 0.0,
    }
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        resp = urllib.request.urlopen(req, timeout=60)
        data = json.loads(resp.read())
        if "choices" not in data:
            return {"_error": f"no choices: {json.dumps(data)[:200]}"}
        text = data["choices"][0]["message"]["content"]
        cleaned = re.sub(r"```(?:json)?", "", text).strip()
        start = cleaned.find("{")
        if start < 0:
            return {"_error": f"no json in: {text[:120]}"}
        depth = 0
        end = -1
        for i in range(start, len(cleaned)):
            if cleaned[i] == "{":
                depth += 1
            elif cleaned[i] == "}":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        if end < 0:
            return {"_error": f"unbalanced json: {text[:120]}"}
        parsed = json.loads(cleaned[start:end])
        return parsed
    except Exception as e:
        return {"_error": f"{type(e).__name__}: {e}"}


def write_batch(batch):
    """Send batch to ocr_all_cards.py"""
    payload = json.dumps(batch, ensure_ascii=False)
    r = subprocess.run(
        ["python", OCR_SCRIPT, "write-batch", payload],
        capture_output=True, text=True, timeout=120
    )
    return r.returncode == 0, r.stdout, r.stderr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--limit", type=int, default=640)
    ap.add_argument("--batch-size", type=int, default=10)
    ap.add_argument("--sleep", type=float, default=2.0, help="seconds between requests")
    args = ap.parse_args()

    key = get_key()
    manifest = json.load(open(MANIFEST, encoding="utf-8"))
    items = manifest[args.start:args.start+args.limit]
    print(f"Processing {len(items)} cards (start={args.start}, sleep={args.sleep}s)", flush=True)

    batch = []
    processed = 0
    errors = 0
    start_time = time.time()

    for i, item in enumerate(items):
        ascii_name = item["ascii_name"]
        cuts_filename = item["cuts_filename"]
        img_path = TMP_DIR / ascii_name

        result = ocr_card(img_path, key)
        if result is None or "_error" in result:
            errors += 1
            err_msg = result.get("_error", "None")[:100] if result else "None"
            print(f"  [{i+1}/{len(items)}] {ascii_name} -> ERROR {err_msg}", flush=True)
        else:
            result["cuts_filename"] = cuts_filename
            batch.append(result)
            processed += 1
            n = result.get("name", "?")[:25]
            print(f"  [{i+1}/{len(items)}] {ascii_name} -> {n} cost={result.get('cost')} atk={result.get('attack')} hp={result.get('health')}", flush=True)

        if len(batch) >= args.batch_size:
            ok, out, err = write_batch(batch)
            if not ok:
                print(f"  ✗ write failed: {err}", flush=True)
                errors += len(batch)
            else:
                print(f"  → wrote batch of {len(batch)}", flush=True)
            batch = []

        time.sleep(args.sleep)

    if batch:
        ok, out, err = write_batch(batch)
        if not ok:
            print(f"  ✗ final write failed: {err}", flush=True)
            errors += len(batch)
        else:
            print(f"  → wrote final batch of {len(batch)}", flush=True)

    elapsed = time.time() - start_time
    rate = processed / elapsed if elapsed else 0
    print(f"\n=== Done: {processed} ok, {errors} errors in {elapsed:.0f}s (rate {rate:.2f}/s) ===", flush=True)


if __name__ == "__main__":
    main()