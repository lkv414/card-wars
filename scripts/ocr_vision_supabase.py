#!/usr/bin/env python3
"""
ocr_vision_supabase.py — Hermes vision_analyze vs Supabase cards.

Берёт cards.image_url из Supabase, для каждой карты вызывает Hermes
vision_analyze_tool (OpenRouter vision), сравнивает с БД, опционально PATCH.

Запуск:
  python scripts/ocr_vision_supabase.py --limit 5
  python scripts/ocr_vision_supabase.py --card-id <uuid>
  python scripts/ocr_vision_supabase.py --report-only
  python scripts/ocr_vision_supabase.py --fix          # нужен SUPABASE_SERVICE_KEY
  python scripts/ocr_vision_supabase.py --refresh      # игнорировать кэш

Env:
  VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY  (чтение)
  SUPABASE_SERVICE_KEY                               (--fix)
  OPENROUTER_API_KEY или файл HERMES_OPENROUTER_ENV
  HERMES_AGENT_DIR — путь к hermes-agent (по умолчанию ~/.hermes/hermes-agent)

Кэш: data/vision_ocr_cache.json
Отчёты: data/VISION_VERIFY_REPORT.md, data/vision_verify_results.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from ocr_paddle_supabase import (  # noqa: E402
    fetch_cards,
    load_env,
    supabase_config,
)
from ocr_paddle_utils import compare_card_db_ocr, sanitize_ocr_payload  # noqa: E402

CACHE_PATH = ROOT / "data" / "vision_ocr_cache.json"
REPORT_MD = ROOT / "data" / "VISION_VERIFY_REPORT.md"
REPORT_JSON = ROOT / "data" / "vision_verify_results.json"

DEFAULT_HERMES_AGENT = Path.home() / "AppData" / "Local" / "hermes" / "hermes-agent"
DEFAULT_OR_ENV = Path.home() / "AppData" / "Local" / "hermes" / "keys" / "openrouter.env"

DEFAULT_VISION_MODEL = os.environ.get(
    "HERMES_VISION_MODEL",
    "nvidia/nemotron-nano-12b-v2-vl:free",
)

VISION_PROMPT = """This is a single Card Wars trading card image. Read it CAREFULLY.
Return ONLY one JSON object (no markdown, no commentary):
{
  "name": "Russian name exactly as printed on the card",
  "card_type": "creature|spell|building|landscape",
  "cost": number,
  "attack": number,
  "health": number,
  "land_type": "blue|corn|good|ice|sand|swamp|rainbow|any",
  "is_rainbow": true|false,
  "has_flip": true|false,
  "flip_description": "Russian flip text or null",
  "description": "FULL Russian ability text verbatim or null"
}
Rules:
- cost = number in top-left circle
- attack/health = bottom corners for creatures; 0 for buildings/spells if absent
- Read Cyrillic precisely; do not translate to English
- If unsure about a field use null
Return ONLY the JSON object."""


def load_hermes_env() -> Path:
    """Load OpenRouter key + add hermes-agent to sys.path."""
    or_env_path = Path(
        os.environ.get("HERMES_OPENROUTER_ENV", str(DEFAULT_OR_ENV))
    )
    if or_env_path.is_file():
        for line in or_env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v

    agent_dir = Path(os.environ.get("HERMES_AGENT_DIR", str(DEFAULT_HERMES_AGENT)))
    if not agent_dir.is_dir():
        raise SystemExit(
            f"Hermes agent not found: {agent_dir}\n"
            "Set HERMES_AGENT_DIR to your hermes-agent checkout."
        )
    agent_str = str(agent_dir.resolve())
    if agent_str not in sys.path:
        sys.path.insert(0, agent_str)
    return agent_dir


def parse_json_object(text: str) -> dict | None:
    if not text:
        return None
    cleaned = re.sub(r"```(?:json)?", "", text).strip()
    # Strip optional [scale note] prefix from Hermes vision responses
    cleaned = re.sub(r"^\[[^\]]+\]\s*", "", cleaned)
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
                try:
                    return json.loads(cleaned[start : i + 1])
                except json.JSONDecodeError:
                    return None
    return None


def parse_vision_tool_result(raw: Any) -> tuple[dict | None, str | None]:
    """vision_analyze_tool → structured card dict or error."""
    if isinstance(raw, dict):
        if not raw.get("success", True):
            return None, raw.get("error") or raw.get("analysis") or "vision failed"
        text = raw.get("analysis") or raw.get("text") or ""
    elif isinstance(raw, str):
        text = raw.strip()
        if text.startswith("{"):
            try:
                envelope = json.loads(text)
                if isinstance(envelope, dict):
                    return parse_vision_tool_result(envelope)
            except json.JSONDecodeError:
                pass
        text = text
    else:
        return None, f"unexpected result type: {type(raw).__name__}"

    parsed = parse_json_object(text)
    if not parsed:
        return None, f"no json in response: {text[:160]}"
    return parsed, None


def vision_fields_to_ocr(parsed: dict) -> dict:
    """Map vision JSON → compare/patch shape."""
    return sanitize_ocr_payload({
        "name": parsed.get("name"),
        "cost": parsed.get("cost"),
        "attack": parsed.get("attack"),
        "health": parsed.get("health"),
        "description": parsed.get("description"),
        "card_type": parsed.get("card_type"),
        "land_type": parsed.get("land_type"),
        "has_flip": parsed.get("has_flip"),
        "flip_description": parsed.get("flip_description"),
        "is_rainbow": parsed.get("is_rainbow"),
        "raw": parsed,
    })


async def run_hermes_vision(
    image_url: str,
    *,
    model: str | None = None,
    prompt: str = VISION_PROMPT,
) -> tuple[dict | None, str | None]:
    from tools.vision_tools import vision_analyze_tool

    kwargs: dict[str, Any] = {}
    if model:
        kwargs["model"] = model
    raw = await vision_analyze_tool(image_url, prompt, **kwargs)
    parsed, err = parse_vision_tool_result(raw)
    if err or not parsed:
        return None, err
    return vision_fields_to_ocr(parsed), None


def run_hermes_vision_sync(
    image_url: str,
    *,
    model: str | None = None,
    retries: int = 2,
) -> tuple[dict | None, str | None]:
    last_err: str | None = None
    for attempt in range(max(1, retries)):
        ocr, err = asyncio.run(run_hermes_vision(image_url, model=model))
        if ocr:
            return ocr, None
        last_err = err
        if attempt + 1 < retries:
            time.sleep(2.0)
    return None, last_err


def load_cache() -> dict:
    if CACHE_PATH.is_file():
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    return {"items": {}, "updated_at": None}


def save_cache(cache: dict) -> None:
    cache["updated_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def patch_card_extended(url: str, service_key: str, card_id: str, ocr: dict) -> None:
    import requests

    payload: dict[str, Any] = {}
    if ocr.get("name"):
        payload["name"] = ocr["name"]
    for field in ("cost", "attack", "health"):
        if ocr.get(field) is not None:
            payload[field] = ocr[field]
    if ocr.get("description"):
        payload["description"] = ocr["description"]
    if ocr.get("card_type"):
        payload["card_type"] = ocr["card_type"]
    if ocr.get("land_type"):
        payload["land_type"] = ocr["land_type"]
    if ocr.get("has_flip") is not None:
        payload["has_flip"] = bool(ocr["has_flip"])
    if ocr.get("flip_description"):
        payload["flip_description"] = ocr["flip_description"]
    if ocr.get("is_rainbow") is not None:
        payload["is_rainbow"] = bool(ocr["is_rainbow"])
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


def write_reports(results: list[dict]) -> None:
    mismatches = [r for r in results if r.get("diffs")]
    errors = [r for r in results if r.get("error")]

    lines = [
        "# Hermes Vision vs Supabase — отчёт сверки",
        "",
        f"Проверено: **{len(results)}**",
        f"Расхождения: **{len(mismatches)}**",
        f"OCR ошибки: **{len(errors)}**",
        "",
        "## Карты с расхождениями",
        "",
        "| № | name (DB) | поле | DB | Vision |",
        "|--:|-----------|------|----|--------|",
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


def main() -> None:
    ap = argparse.ArgumentParser(description="Hermes vision verify/update Supabase cards")
    ap.add_argument("--limit", type=int, default=0, help="max cards (0 = all)")
    ap.add_argument("--card-id", help="single card UUID")
    ap.add_argument("--only-mismatches", action="store_true")
    ap.add_argument("--report-only", action="store_true", help="use cache only")
    ap.add_argument("--refresh", action="store_true", help="ignore cache")
    ap.add_argument("--fix", action="store_true", help="PATCH cards from vision (SERVICE_KEY)")
    ap.add_argument("--fix-all", action="store_true", help="PATCH even when no diffs")
    ap.add_argument("--name-threshold", type=float, default=0.78)
    ap.add_argument(
        "--model",
        default=DEFAULT_VISION_MODEL,
        help=f"OpenRouter vision model (default: {DEFAULT_VISION_MODEL})",
    )
    ap.add_argument("--retries", type=int, default=2, help="vision retries on failure")
    ap.add_argument("--sleep", type=float, default=1.5, help="seconds between API calls")
    args = ap.parse_args()

    os.chdir(ROOT)
    load_hermes_env()
    env = load_env()
    sb_url, sb_key = supabase_config(env)
    service_key = env.get("SUPABASE_SERVICE_KEY")

    if not os.environ.get("OPENROUTER_API_KEY"):
        print("Warning: OPENROUTER_API_KEY not set — Hermes vision will likely fail.")

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
        image_url = card.get("image_url") or ""
        entry: dict = {
            "id": cid,
            "card_number": card.get("card_number"),
            "db_name": card.get("name"),
            "image_url": image_url,
        }

        cached = cache["items"].get(cid)
        if args.report_only:
            if not cached or "ocr" not in cached:
                continue
            ocr = cached["ocr"]
            entry["ocr_source"] = "cache"
        elif (
            not args.refresh
            and cached
            and cached.get("ocr")
            and not cached.get("error")
        ):
            ocr = cached["ocr"]
            entry["ocr_source"] = "cache"
        else:
            try:
                ocr, err = run_hermes_vision_sync(
                    image_url, model=args.model or None, retries=args.retries,
                )
                if err or not ocr:
                    raise RuntimeError(err or "empty vision result")
                cache["items"][cid] = {"ocr": ocr, "engine": "hermes_vision"}
                save_cache(cache)
                entry["ocr_source"] = "hermes"
            except Exception as e:
                entry["error"] = str(e)
                cache["items"][cid] = {"error": str(e)}
                save_cache(cache)
                results.append(entry)
                print(f"[{i}/{len(cards)}] #{card.get('card_number')} VISION FAIL: {e}")
                if args.sleep > 0 and i < len(cards):
                    time.sleep(args.sleep)
                continue

        diffs = compare_card_db_ocr(card, ocr, name_threshold=args.name_threshold)
        entry["ocr"] = {
            k: ocr.get(k)
            for k in (
                "name", "cost", "attack", "health", "description",
                "card_type", "land_type", "has_flip", "flip_description",
            )
        }
        entry["diffs"] = diffs

        should_fix = args.fix and (args.fix_all or diffs)
        if should_fix:
            if not service_key:
                entry["fix_error"] = "SUPABASE_SERVICE_KEY required"
            else:
                try:
                    patch_card_extended(sb_url, service_key, cid, ocr)
                    entry["fixed"] = True
                except Exception as e:
                    entry["fix_error"] = str(e)

        results.append(entry)
        status = "OK" if not diffs else f"DIFF({len(diffs)})"
        ocr_name = (ocr.get("name") or "?")[:35]
        if not (args.only_mismatches and not diffs):
            print(
                f"[{i}/{len(cards)}] #{card.get('card_number')} {status} "
                f"db={card.get('name', '')[:28]!r} vision={ocr_name!r}"
            )

        if i % 10 == 0:
            save_cache(cache)
        if args.sleep > 0 and i < len(cards) and entry.get("ocr_source") == "hermes":
            time.sleep(args.sleep)

    write_reports(results)
    save_cache(cache)

    diff_n = sum(1 for r in results if r.get("diffs"))
    err_n = sum(1 for r in results if r.get("error"))
    fixed_n = sum(1 for r in results if r.get("fixed"))
    elapsed = time.time() - start
    print(
        f"\nDone in {elapsed:.0f}s: checked={len(results)} "
        f"diffs={diff_n} errors={err_n} fixed={fixed_n}"
    )
    print(f"Report: {REPORT_MD}")
    print(f"JSON:   {REPORT_JSON}")


if __name__ == "__main__":
    main()
