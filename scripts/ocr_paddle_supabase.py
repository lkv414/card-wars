#!/usr/bin/env python3
"""
ocr_paddle_supabase.py — бесплатная сверка карт: PaddleOCR vs Supabase.

Скачивает cards.image_url (public Storage), распознаёт русский текст,
сравнивает name / cost / attack / health / description с записью в БД.

Запуск:
  pip install -r scripts/requirements-ocr.txt
  python scripts/ocr_paddle_supabase.py --limit 5
  python scripts/ocr_paddle_supabase.py
  python scripts/ocr_paddle_supabase.py --only-mismatches
  python scripts/ocr_paddle_supabase.py --report-only
  python scripts/ocr_paddle_supabase.py --card-id 00286762-cca6-42a1-a904-ff9e2fc20b3a

Env (.env / .env.secure / переменные окружения):
  VITE_SUPABASE_URL  или SUPABASE_URL
  VITE_SUPABASE_PUBLISHABLE_KEY или SUPABASE_ANON_KEY  (чтение cards)
  SUPABASE_SERVICE_KEY  (только для --fix)

Кэш: data/paddle_ocr_cache.json
Отчёты: data/PADDLE_VERIFY_REPORT.md, data/paddle_verify_results.json
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from ocr_paddle_utils import compare_card_db_ocr, convert_paddle_v3_results, parse_card_from_ocr, sanitize_ocr_payload

CACHE_PATH = ROOT / "data" / "paddle_ocr_cache.json"
REPORT_MD = ROOT / "data" / "PADDLE_VERIFY_REPORT.md"
REPORT_JSON = ROOT / "data" / "paddle_verify_results.json"


def load_env() -> dict[str, str]:
    out: dict[str, str] = {}
    for name in (".env.secure", ".env.local", ".env"):
        path = ROOT / name
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    out.update({k: v for k, v in os.environ.items() if v})
    return out


def supabase_config(env: dict[str, str]) -> tuple[str, str]:
    url = env.get("SUPABASE_URL") or env.get("VITE_SUPABASE_URL")
    key = (
        env.get("SUPABASE_ANON_KEY")
        or env.get("VITE_SUPABASE_PUBLISHABLE_KEY")
        or env.get("SUPABASE_SERVICE_KEY")
    )
    if not url or not key:
        raise SystemExit(
            "Need VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY (or SUPABASE_* equivalents)"
        )
    return url.rstrip("/"), key


def fetch_cards(url: str, key: str, *, card_id: str | None = None) -> list[dict]:
    try:
        import requests
    except ImportError as e:
        raise SystemExit("pip install requests") from e

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }
    params = {
        "select": "id,card_number,name,card_type,cost,attack,health,description,image_url,land_type",
        "order": "card_number",
    }
    endpoint = f"{url}/rest/v1/cards"
    if card_id:
        endpoint += f"?id=eq.{card_id}"
        resp = requests.get(endpoint, headers=headers, params=params, timeout=60)
    else:
        resp = requests.get(endpoint, headers=headers, params=params, timeout=120)
    resp.raise_for_status()
    rows = resp.json()
    return [r for r in rows if r.get("image_url")]


def download_image(image_url: str) -> tuple[bytes, int, int]:
    import requests
    from PIL import Image

    resp = requests.get(image_url, timeout=60)
    resp.raise_for_status()
    img = Image.open(io.BytesIO(resp.content)).convert("RGB")
    w, h = img.size
    return resp.content, w, h


def configure_paddle_env() -> None:
    """Avoid Paddle 3.x + oneDNN crash on Windows CPU."""
    os.environ.setdefault("FLAGS_use_mkldnn", "0")
    os.environ.setdefault("FLAGS_enable_pir_api", "0")
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    os.environ.setdefault("PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT", "0")


def run_easyocr_on_bytes(png_bytes: bytes, *, lang: str = "ru"):
    import io

    import numpy as np
    from PIL import Image

    try:
        import easyocr
    except ImportError as e:
        raise SystemExit("pip install easyocr") from e

    langs = [lang]
    if not hasattr(run_easyocr_on_bytes, "_reader"):
        run_easyocr_on_bytes._reader = easyocr.Reader(langs, gpu=False, verbose=False)

    img = np.array(Image.open(io.BytesIO(png_bytes)).convert("RGB"))
    results = run_easyocr_on_bytes._reader.readtext(img)
    legacy: list = []
    for box, text, conf in results:
        legacy.append([box, (text, float(conf))])
    return [legacy]


def run_ocr_on_bytes(png_bytes: bytes, *, lang: str = "ru", engine: str = "auto"):
    if engine == "easyocr":
        return run_easyocr_on_bytes(png_bytes, lang=lang)
    if engine == "paddle":
        return run_paddle_on_bytes(png_bytes, lang=lang)
    # auto: paddle first, easyocr on failure
    try:
        return run_paddle_on_bytes(png_bytes, lang=lang)
    except Exception as paddle_err:
        try:
            return run_easyocr_on_bytes(png_bytes, lang=lang)
        except Exception as easy_err:
            raise RuntimeError(f"paddle: {paddle_err}; easyocr: {easy_err}") from easy_err


def run_paddle_on_bytes(png_bytes: bytes, *, lang: str = "ru"):
    import inspect
    import tempfile
    from pathlib import Path

    configure_paddle_env()

    try:
        from paddleocr import PaddleOCR
    except ImportError as e:
        raise SystemExit(
            "Install OCR deps: pip install -r scripts/requirements-ocr.txt"
        ) from e

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp.write(png_bytes)
        tmp_path = tmp.name

    try:
        if not hasattr(run_paddle_on_bytes, "_ocr"):
            sig = inspect.signature(PaddleOCR.__init__)
            kwargs: dict = {"lang": lang, "enable_mkldnn": False}
            if "use_textline_orientation" in sig.parameters:
                kwargs["use_textline_orientation"] = True
            elif "use_angle_cls" in sig.parameters:
                kwargs["use_angle_cls"] = True
            if "show_log" in sig.parameters:
                kwargs["show_log"] = False
            run_paddle_on_bytes._ocr = PaddleOCR(**kwargs)
            run_paddle_on_bytes._use_predict = hasattr(run_paddle_on_bytes._ocr, "predict")

        ocr = run_paddle_on_bytes._ocr
        if getattr(run_paddle_on_bytes, "_use_predict", False):
            return convert_paddle_v3_results(list(ocr.predict(tmp_path)))

        if hasattr(ocr, "ocr"):
            try:
                return ocr.ocr(tmp_path, cls=True)
            except TypeError:
                return ocr.ocr(tmp_path)

        if hasattr(ocr, "predict"):
            return convert_paddle_v3_results(list(ocr.predict(tmp_path)))

        raise RuntimeError("Unsupported PaddleOCR version (no ocr/predict)")
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def load_cache() -> dict:
    if CACHE_PATH.is_file():
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    return {"items": {}, "updated_at": None}


def save_cache(cache: dict) -> None:
    cache["updated_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def write_reports(results: list[dict]) -> None:
    mismatches = [r for r in results if r.get("diffs")]
    errors = [r for r in results if r.get("error")]

    lines = [
        "# PaddleOCR vs Supabase — отчёт сверки",
        "",
        f"Проверено: **{len(results)}**",
        f"Расхождения: **{len(mismatches)}**",
        f"OCR ошибки: **{len(errors)}**",
        "",
        "## Карты с расхождениями",
        "",
        "| № | name (DB) | поле | DB | OCR |",
        "|--:|-----------|------|----|-----|",
    ]
    for r in mismatches[:200]:
        num = r.get("card_number", "?")
        db_name = (r.get("db_name") or "")[:40]
        for d in r.get("diffs") or []:
            db_v = str(d.get("db", ""))[:50].replace("|", "/")
            ocr_v = str(d.get("ocr", ""))[:50].replace("|", "/")
            lines.append(f"| {num} | {db_name} | {d['field']} | {db_v} | {ocr_v} |")

    if len(mismatches) > 200:
        lines.append("")
        lines.append(f"_… и ещё {len(mismatches) - 200} карт_")

    REPORT_MD.parent.mkdir(parents=True, exist_ok=True)
    REPORT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")
    REPORT_JSON.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")


def patch_card(url: str, service_key: str, card_id: str, ocr: dict) -> None:
    import requests

    payload = {}
    if ocr.get("name"):
        payload["name"] = ocr["name"]
    for field in ("cost", "attack", "health"):
        if ocr.get(field) is not None:
            payload[field] = ocr[field]
    if ocr.get("description"):
        payload["description"] = ocr["description"]
    if not payload:
        return

    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    resp = requests.patch(
        f"{url}/rest/v1/cards?id=eq.{card_id}",
        headers=headers,
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()


def main() -> None:
    ap = argparse.ArgumentParser(description="PaddleOCR verify cards against Supabase")
    ap.add_argument("--limit", type=int, default=0, help="max cards (0 = all)")
    ap.add_argument("--card-id", help="single card UUID")
    ap.add_argument("--only-mismatches", action="store_true", help="print only diffs")
    ap.add_argument("--report-only", action="store_true", help="use cache only")
    ap.add_argument("--fix", action="store_true", help="PATCH cards from OCR (needs SERVICE_KEY)")
    ap.add_argument("--name-threshold", type=float, default=0.78)
    ap.add_argument("--lang", default="ru")
    ap.add_argument("--engine", choices=("auto", "paddle", "easyocr"), default="paddle")
    args = ap.parse_args()

    os.chdir(ROOT)
    env = load_env()
    sb_url, sb_key = supabase_config(env)
    service_key = env.get("SUPABASE_SERVICE_KEY")

    cards = fetch_cards(sb_url, sb_key, card_id=args.card_id)
    if args.limit:
        cards = cards[: args.limit]

    if not cards:
        print("No cards with image_url found.")
        return

    cache = load_cache()
    results: list[dict] = []
    start = time.time()

    for i, card in enumerate(cards, 1):
        cid = card["id"]
        entry: dict = {
            "id": cid,
            "card_number": card.get("card_number"),
            "db_name": card.get("name"),
            "image_url": card.get("image_url"),
        }

        cached = cache["items"].get(cid)
        if args.report_only:
            if not cached or "ocr" not in cached:
                continue
            ocr = cached["ocr"]
            img_w = cached.get("img_w", 1)
            img_h = cached.get("img_h", 1)
        elif cached and cached.get("ocr") and not cached.get("error"):
            ocr = cached["ocr"]
            img_w = cached.get("img_w", 1)
            img_h = cached.get("img_h", 1)
            entry["ocr_source"] = "cache"
        else:
            try:
                png, img_w, img_h = download_image(card["image_url"])
                raw = run_ocr_on_bytes(png, lang=args.lang, engine=args.engine)
                ocr = parse_card_from_ocr(raw, img_w, img_h)
                ocr = sanitize_ocr_payload(ocr)
                cache["items"][cid] = {
                    "ocr": ocr,
                    "img_w": img_w,
                    "img_h": img_h,
                    "raw_line_count": len(ocr.get("lines") or []),
                    "engine": args.engine if args.engine != "auto" else "auto",
                }
                save_cache(cache)
                entry["ocr_source"] = args.engine if args.engine != "auto" else "ocr"
            except Exception as e:
                entry["error"] = str(e)
                cache["items"][cid] = {"error": str(e)}
                save_cache(cache)
                results.append(entry)
                print(f"[{i}/{len(cards)}] #{card.get('card_number')} OCR FAIL: {e}")
                continue

        diffs = compare_card_db_ocr(card, ocr, name_threshold=args.name_threshold)
        entry["ocr"] = {
            k: ocr.get(k)
            for k in ("name", "cost", "attack", "health", "description", "all_text")
        }
        entry["diffs"] = diffs

        if diffs and args.fix:
            if not service_key:
                entry["fix_error"] = "SUPABASE_SERVICE_KEY required"
            else:
                try:
                    patch_card(sb_url, service_key, cid, ocr)
                    entry["fixed"] = True
                except Exception as e:
                    entry["fix_error"] = str(e)

        results.append(entry)
        status = "OK" if not diffs else f"DIFF({len(diffs)})"
        ocr_name = (ocr.get("name") or "?")[:35]
        if args.only_mismatches and not diffs:
            continue
        print(
            f"[{i}/{len(cards)}] #{card.get('card_number')} {status} "
            f"db={card.get('name', '')[:28]!r} ocr={ocr_name!r}"
        )

        if i % 25 == 0:
            save_cache(cache)

    write_reports(results)
    save_cache(cache)

    diff_n = sum(1 for r in results if r.get("diffs"))
    err_n = sum(1 for r in results if r.get("error"))
    elapsed = time.time() - start
    print(f"\nDone in {elapsed:.0f}s: checked={len(results)} diffs={diff_n} errors={err_n}")
    print(f"Report: {REPORT_MD}")
    print(f"JSON:   {REPORT_JSON}")


if __name__ == "__main__":
    main()
