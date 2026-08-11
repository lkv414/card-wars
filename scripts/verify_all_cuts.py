"""
verify_all_cuts.py — OCR каждого cut PNG и сверка с БД.

Запуск:
  python scripts/verify_all_cuts.py --fix          # все 640 + авто-правки
  python scripts/verify_all_cuts.py --hero fiona   # одна колода
  python scripts/verify_all_cuts.py --report-only  # без OCR, только diff из кэша

Кэш: data/cut_verification_cache.json (resume после обрыва)
Отчёт: data/VERIFY_REPORT.md
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import time
import uuid
from difflib import SequenceMatcher
from pathlib import Path

from build_card_catalog import DECK_REGISTRY, ROOT


def cuts_source_url(hero_slug, cuts_filename):
    set_folder, hero_folder, _, _, _, _ = DECK_REGISTRY[hero_slug]
    return f"{set_folder}/{hero_folder}/cuts/{cuts_filename}"

DB_PATH = r"C:\Users\<redacted>\WebstormProjects\card_game\data\cards.db"
CACHE_PATH = r"C:\Users\<redacted>\WebstormProjects\card_game\data\cut_verification_cache.json"
REPORT_PATH = r"C:\Users\<redacted>\WebstormProjects\card_game\data\VERIFY_REPORT.md"
OR_ENV = r"C:\Users\<redacted>\AppData\Local\hermes\keys\openrouter.env"

CUT_PROMPT = """This is a single Card Wars trading card image. Read it CAREFULLY.
Return ONLY one JSON object:
{
  "name": "Russian name exactly as printed",
  "card_type": "creature|spell|building|landscape",
  "cost": number,
  "attack": number,
  "health": number,
  "land_type": "blue|corn|nice|ice|sand|swamp|rainbow|any",
  "is_rainbow": true|false,
  "has_flip": true|false,
  "flip_description": "text or null",
  "description": "FULL Russian ability text verbatim or null"
}
Use attack/health from bottom corners for creatures. Return ONLY JSON."""


def norm(s):
    if s is None:
        return ""
    return re.sub(r"\s+", " ", str(s).strip().lower())


def name_similar(a, b):
    if not a or not b:
        return False
    a, b = norm(a), norm(b)
    if a == b or a in b or b in a:
        return True
    return SequenceMatcher(None, a, b).ratio() >= 0.82


def load_cache():
    if os.path.isfile(CACHE_PATH):
        with open(CACHE_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {"items": {}, "updated_at": None}


def save_cache(cache):
    cache["updated_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def ascii_copy(src_path: str) -> str:
    tmp = tempfile.mkdtemp(prefix="cut_verify_")
    dst = os.path.join(tmp, f"cut_{uuid.uuid4().hex[:8]}.png")
    shutil.copy(src_path, dst)
    return dst


def parse_json_object(text: str):
    cleaned = re.sub(r"```(?:json)?", "", text).strip()
    start = cleaned.find("{")
    if start < 0:
        return None
    depth = 0
    for i in range(start, len(cleaned)):
        if cleaned[i] == "{":
            depth += 1
        elif cleaned[i] == "}":
            depth -= 1
            if depth == 0:
                return json.loads(cleaned[start : i + 1])
    return None


def ocr_via_hermes(img_path: str):
    try:
        from hermes_tools import vision_analyze
    except ImportError:
        return None, "hermes_tools unavailable"
    ascii_path = ascii_copy(img_path)
    try:
        result = vision_analyze(image_url=ascii_path, question=CUT_PROMPT)
        text = result.get("text", "") if isinstance(result, dict) else str(result)
        parsed = parse_json_object(text)
        if not parsed:
            return None, f"no json: {text[:120]}"
        return parsed, None
    except Exception as e:
        return None, str(e)
    finally:
        try:
            os.remove(ascii_path)
            os.rmdir(os.path.dirname(ascii_path))
        except OSError:
            pass


def ocr_via_openrouter(img_path: str):
    if not os.path.isfile(OR_ENV):
        return None, "openrouter env missing"
    import base64
    import urllib.request

    with open(OR_ENV, encoding="utf-8") as f:
        m = re.search(r"OPENROUTER_API_KEY=(\S+)", f.read())
    if not m:
        return None, "openrouter key missing"
    key = m.group(1)
    b64 = base64.b64encode(Path(img_path).read_bytes()).decode("ascii")
    body = {
        "model": "nvidia/nemotron-nano-12b-v2-vl:free",
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": CUT_PROMPT},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
            ],
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
        resp = urllib.request.urlopen(req, timeout=90)
        data = json.loads(resp.read())
        text = data["choices"][0]["message"]["content"]
        parsed = parse_json_object(text)
        if not parsed:
            return None, f"no json: {text[:120]}"
        return parsed, None
    except Exception as e:
        return None, str(e)


def ocr_cut(img_path: str):
    ocr, err = ocr_via_openrouter(img_path)
    if ocr:
        return ocr, "openrouter"
    ocr2, err2 = ocr_via_hermes(img_path)
    if ocr2:
        return ocr2, "hermes"
    return None, f"openrouter:{err}; hermes:{err2}"


def list_jobs(con, hero_filter=None):
    cur = con.cursor()
    q = """
        SELECT pd.slug, pdc.slot, pdc.cuts_filename, pdc.card_id,
               c.name, c.card_type, c.cost, c.attack, c.health,
               c.land_type, c.description, ca.source_url
        FROM preset_deck_cards pdc
        JOIN preset_decks pd ON pd.id = pdc.preset_deck_id
        JOIN cards c ON c.id = pdc.card_id
        LEFT JOIN card_art ca ON ca.deck_slug = pd.slug
            AND ca.cuts_filename = pdc.cuts_filename AND ca.card_id = pdc.card_id
    """
    if hero_filter:
        q += " WHERE pd.slug = ? ORDER BY pd.slug, pdc.slot"
        return cur.execute(q, (hero_filter,)).fetchall()
    q += " ORDER BY pd.slug, pdc.slot"
    return cur.execute(q).fetchall()


def compare(db_row, ocr):
    slug, slot, cuts_fn, card_id, name, ctype, cost, atk, hp, land, desc, url = db_row
    diffs = []
    fields = [
        ("name", name, ocr.get("name")),
        ("card_type", ctype, ocr.get("card_type")),
        ("cost", cost, ocr.get("cost")),
        ("attack", atk, ocr.get("attack")),
        ("health", hp, ocr.get("health")),
        ("land_type", land, ocr.get("land_type")),
        ("description", desc, ocr.get("description")),
    ]
    for field, db_val, ocr_val in fields:
        if ocr_val is None:
            continue
        if field == "name":
            if not name_similar(db_val, ocr_val):
                diffs.append({"field": field, "db": db_val, "ocr": ocr_val})
        elif field == "description":
            if db_val and ocr_val and norm(db_val) != norm(ocr_val):
                if SequenceMatcher(None, norm(db_val), norm(ocr_val)).ratio() < 0.75:
                    diffs.append({"field": field, "db": (db_val or "")[:80], "ocr": (ocr_val or "")[:80]})
        else:
            try:
                if int(db_val or 0) != int(ocr_val or 0):
                    diffs.append({"field": field, "db": db_val, "ocr": ocr_val})
            except (TypeError, ValueError):
                if norm(db_val) != norm(ocr_val):
                    diffs.append({"field": field, "db": db_val, "ocr": ocr_val})
    return diffs


def apply_fix(cur, card_id, ocr):
    new_name = ocr.get("name")
    if new_name:
        row = cur.execute(
            "SELECT id FROM cards WHERE name=? AND id!=?", (new_name, card_id)
        ).fetchone()
        if row:
            new_name = None  # skip rename — another card already owns this name

    cur.execute(
        """
        UPDATE cards SET
            name = COALESCE(?, name),
            card_type = COALESCE(?, card_type),
            cost = COALESCE(?, cost),
            attack = COALESCE(?, attack),
            health = COALESCE(?, health),
            land_type = COALESCE(?, land_type),
            is_rainbow = COALESCE(?, is_rainbow),
            has_flip = COALESCE(?, has_flip),
            flip_description = COALESCE(?, flip_description),
            description = COALESCE(?, description),
            updated_at = datetime('now')
        WHERE id = ?
        """,
        (
            new_name,
            ocr.get("card_type"),
            ocr.get("cost"),
            ocr.get("attack"),
            ocr.get("health"),
            ocr.get("land_type"),
            1 if ocr.get("is_rainbow") else (0 if ocr.get("is_rainbow") is False else None),
            1 if ocr.get("has_flip") else (0 if ocr.get("has_flip") is False else None),
            ocr.get("flip_description"),
            ocr.get("description"),
            card_id,
        ),
    )


def write_report(results):
    lines = [
        "# Cut verification report",
        "",
        f"Total checked: {len(results)}",
        f"With diffs: {sum(1 for r in results if r.get('diffs'))}",
        f"OCR errors: {sum(1 for r in results if r.get('error'))}",
        f"Fixed: {sum(1 for r in results if r.get('fixed'))}",
        "",
        "## Mismatches (first 80)",
        "",
        "| deck | slot | cut | field | db | ocr |",
        "|------|-----:|-----|-------|----|----|",
    ]
    n = 0
    for r in results:
        if not r.get("diffs"):
            continue
        for d in r["diffs"]:
            lines.append(
                f"| {r['slug']} | {r['slot']} | {r['cuts']} | {d['field']} | {d['db']} | {d['ocr']} |"
            )
            n += 1
            if n >= 80:
                break
        if n >= 80:
            break
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hero", help="single deck slug")
    ap.add_argument("--fix", action="store_true", help="apply OCR fixes to cards table")
    ap.add_argument("--report-only", action="store_true")
    ap.add_argument("--sleep", type=float, default=0.8)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    sys.path.insert(0, os.path.join(os.getcwd(), "scripts"))

    con = sqlite3.connect(DB_PATH)
    cache = load_cache()
    jobs = list_jobs(con, args.hero)
    if args.limit:
        jobs = jobs[: args.limit]

    cur = con.cursor()
    results = []
    start = time.time()

    for i, row in enumerate(jobs, 1):
        slug, slot, cuts_fn, card_id = row[0], row[1], row[2], row[3]
        key = f"{slug}:{slot}:{cuts_fn}"
        url = row[11] or cuts_source_url(slug, cuts_fn)
        abs_path = os.path.join(ROOT, url.replace("/", os.sep))

        entry = {"slug": slug, "slot": slot, "cuts": cuts_fn, "path": abs_path}

        if not os.path.isfile(abs_path):
            entry["error"] = "file missing"
            results.append(entry)
            print(f"[{i}/{len(jobs)}] {key} MISSING")
            continue

        if args.report_only:
            cached = cache["items"].get(key)
            if not cached or "ocr" not in cached:
                continue
            ocr = cached["ocr"]
            entry["ocr_source"] = cached.get("source")
        else:
            cached = cache["items"].get(key)
            if cached and cached.get("ocr") and not cached.get("error"):
                ocr = cached["ocr"]
                entry["ocr_source"] = cached.get("source", "cache")
            else:
                ocr, source_or_err = ocr_cut(abs_path)
                if not ocr:
                    time.sleep(args.sleep)
                    ocr, source_or_err = ocr_cut(abs_path)  # one retry
                if not ocr:
                    entry["error"] = source_or_err
                    cache["items"][key] = {"error": source_or_err}
                    save_cache(cache)
                    results.append(entry)
                    print(f"[{i}/{len(jobs)}] {key} OCR FAIL")
                    time.sleep(args.sleep)
                    continue
                cache["items"][key] = {"ocr": ocr, "source": source_or_err}
                save_cache(cache)
                entry["ocr_source"] = source_or_err
                time.sleep(args.sleep)

        diffs = compare(row, ocr)
        entry["diffs"] = diffs
        entry["ocr_name"] = ocr.get("name")

        if diffs and args.fix:
            try:
                apply_fix(cur, card_id, ocr)
                entry["fixed"] = True
                con.commit()
            except sqlite3.IntegrityError as e:
                entry["fix_error"] = str(e)
                con.rollback()
                print(f"[{i}/{len(jobs)}] {key} FIX SKIP: {e}")

        results.append(entry)
        status = "OK" if not diffs else f"DIFF({len(diffs)})"
        print(f"[{i}/{len(jobs)}] {key} {status} ocr={ocr.get('name','?')[:30]}")

        if i % 20 == 0:
            save_cache(cache)

    write_report(results)
    save_cache(cache)
    con.close()

    elapsed = time.time() - start
    diffs_n = sum(1 for r in results if r.get("diffs"))
    fixed_n = sum(1 for r in results if r.get("fixed"))
    err_n = sum(1 for r in results if r.get("error"))
    print(f"\nDone in {elapsed:.0f}s: checked={len(results)} diffs={diffs_n} fixed={fixed_n} errors={err_n}")
    print(f"Report: {REPORT_PATH}")


if __name__ == "__main__":
    main()
