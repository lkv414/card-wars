"""
export_cards_to_supabase.py — Экспорт локального каталога cards.db в Supabase.

Читает data/cards.db (396 карт, 18 preset decks) и генерирует SQL-файл
для замены данных в production Supabase.

Запуск:
  python scripts/export_cards_to_supabase.py
  python scripts/export_cards_to_supabase.py --dry-run
  python scripts/export_cards_to_supabase.py --upload-images   # требует env vars

Переменные окружения (для --upload-images):
  SUPABASE_URL          https://xxx.supabase.co
  SUPABASE_SERVICE_KEY  service_role key
  CARD_IMAGE_ROOT       путь к папке Card Wars (по умолчанию из build_card_catalog)

Выходные файлы:
  data/supabase_cards_export.sql   — SQL для Supabase SQL Editor
  data/supabase_id_map.json        — маппинг sqlite_id → uuid
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "cards.db"
SQL_OUT = ROOT / "data" / "supabase_cards_export.sql"
MAP_OUT = ROOT / "data" / "supabase_id_map.json"
IMAGE_ROOT = Path(
    os.environ.get(
        "CARD_IMAGE_ROOT",
        r"C:\Users\<redacted>\Music\Adventure Time Card Wars",
    )
)
STORAGE_BUCKET = os.environ.get("SUPABASE_CARD_BUCKET", "card-images")

# Локальные land_type → значения фронта (constants/game.js)
LAND_TYPE_MAP = {
    "nice": "good",
    "desert": "sand",
    "rainbow": "any",
    "sand": "sand",
    "swamp": "swamp",
    "corn": "corn",
    "ice": "ice",
    "blue": "blue",
    "any": "any",
}


def hex_to_uuid(hex_id: str) -> str:
    """32-char hex → UUID string."""
    h = hex_id.replace("-", "")
    if len(h) != 32:
        return str(uuid.uuid4())
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


def sql_str(val) -> str:
    if val is None:
        return "NULL"
    return "'" + str(val).replace("'", "''") + "'"


def sql_bool(val) -> str:
    return "true" if val else "false"


def sql_json(val) -> str:
    if val is None or val == "":
        return "'[]'::jsonb"
    if isinstance(val, str):
        try:
            parsed = json.loads(val)
            return sql_str(json.dumps(parsed, ensure_ascii=False)) + "::jsonb"
        except json.JSONDecodeError:
            return "'[]'::jsonb"
    return sql_str(json.dumps(val, ensure_ascii=False)) + "::jsonb"


def extract_hero(tags_json: str | None) -> str | None:
    if not tags_json:
        return None
    try:
        tags = json.loads(tags_json)
    except json.JSONDecodeError:
        return None
    for tag in tags:
        if isinstance(tag, str) and tag.startswith("hero:"):
            slug = tag.split(":", 1)[1]
            return slug.replace("_", " ").title()
    return None


def map_land_type(raw: str | None, is_rainbow: bool) -> str:
    if is_rainbow or raw == "rainbow":
        return "any"
    return LAND_TYPE_MAP.get(raw or "any", raw or "any")


def load_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        out[key.strip()] = val.strip()
    return out


def resolve_supabase_url() -> str:
    env = {
        **load_env_file(ROOT / ".env"),
        **load_env_file(ROOT / ".env.local"),
        **os.environ,
    }
    return env.get("SUPABASE_URL") or env.get("VITE_SUPABASE_URL") or ""


def validate_supabase_url(url: str) -> None:
    if not url:
        print("ERROR: set SUPABASE_URL or VITE_SUPABASE_URL in .env", file=sys.stderr)
        sys.exit(1)
    if "xxx" in url or "your-project" in url:
        print(f"ERROR: placeholder URL detected: {url}", file=sys.stderr)
        print("Use real URL from .env: https://<supabase-project>.supabase.co", file=sys.stderr)
        sys.exit(1)


def resolve_service_key() -> str:
    env = {**load_env_file(ROOT / ".env.secure"), **os.environ}
    return env.get("SUPABASE_SERVICE_KEY") or env.get("SUPABASE_SERVICE_ROLE_KEY") or ""


def validate_service_key(key: str) -> None:
    if not key:
        print("ERROR: set SUPABASE_SERVICE_KEY (Dashboard -> Settings -> API -> service_role)", file=sys.stderr)
        sys.exit(1)
    if key in ("service_role_key", "your_service_role_key"):
        print("ERROR: placeholder service key detected", file=sys.stderr)
        sys.exit(1)


def resolve_image_path(source_url: str | None) -> Path | None:
    if not source_url:
        return None
    full = IMAGE_ROOT / source_url.replace("/", os.sep)
    return full if full.is_file() else None


def storage_public_url(supabase_url: str, object_path: str) -> str:
    base = supabase_url.rstrip("/")
    return f"{base}/storage/v1/object/public/{STORAGE_BUCKET}/{object_path}"


def upload_images(cards: list[dict], id_map: dict[str, str], supabase_url: str, service_key: str) -> dict[str, str]:
    """Upload cut PNGs to Supabase Storage. Returns card_id → public URL."""
    try:
        import requests
    except ImportError:
        print("ERROR: pip install requests для --upload-images", file=sys.stderr)
        sys.exit(1)

    url_map: dict[str, str] = {}
    headers = {
        "Authorization": f"Bearer {service_key}",
        "apikey": service_key,
    }

    for card in cards:
        sqlite_id = card["id"]
        pg_id = id_map[sqlite_id]
        art_path = resolve_image_path(card.get("_art_path"))
        if not art_path:
            continue

        object_path = f"cards/{pg_id}.png"
        upload_url = f"{supabase_url.rstrip('/')}/storage/v1/object/{STORAGE_BUCKET}/{object_path}"

        with open(art_path, "rb") as f:
            resp = requests.post(
                upload_url,
                headers={**headers, "Content-Type": "image/png", "x-upsert": "true"},
                data=f.read(),
                timeout=60,
            )
        if resp.status_code not in (200, 201):
            print(f"  WARN upload {object_path}: {resp.status_code} {resp.text[:120]}")
            continue

        url_map[sqlite_id] = storage_public_url(supabase_url, object_path)
        print(f"  uploaded {art_path.name} → {object_path}")

    return url_map


def load_catalog(con: sqlite3.Connection) -> tuple[list, list, list, list]:
    con.row_factory = sqlite3.Row

    cards = [dict(r) for r in con.execute("SELECT * FROM cards ORDER BY name COLLATE NOCASE").fetchall()]

    # Primary art per card
    art_by_card: dict[str, str] = {}
    for row in con.execute(
        "SELECT card_id, source_url FROM card_art WHERE is_primary = 1"
    ):
        art_by_card[row["card_id"]] = row["source_url"]
    for card in cards:
        card["_art_path"] = art_by_card.get(card["id"])

    preset_decks = [dict(r) for r in con.execute(
        "SELECT * FROM preset_decks ORDER BY sort_order, name"
    ).fetchall()]

    preset_deck_cards = [dict(r) for r in con.execute(
        "SELECT * FROM preset_deck_cards ORDER BY preset_deck_id, slot"
    ).fetchall()]

    card_art = [dict(r) for r in con.execute("SELECT * FROM card_art").fetchall()]

    return cards, preset_decks, preset_deck_cards, card_art


def build_sql(
    cards: list[dict],
    preset_decks: list[dict],
    preset_deck_cards: list[dict],
    card_art: list[dict],
    id_map: dict[str, str],
    image_urls: dict[str, str],
    supabase_url: str | None,
) -> str:
    lines: list[str] = [
        "-- supabase_cards_export.sql",
        f"-- Generated: {datetime.now(timezone.utc).isoformat()}",
        f"-- Cards: {len(cards)}, Preset decks: {len(preset_decks)}",
        "--",
        "-- ВАЖНО: Сначала примените миграцию 20260802100000_preset_decks.sql",
        "-- Затем выполните этот файл в Supabase SQL Editor (service_role).",
        "-- Сохранённые колоды пользователей (decks) ссылаются на старые UUID —",
        "-- после замены их deck codes перестанут резолвиться.",
        "",
        "BEGIN;",
        "",
        "-- Очистка (порядок из-за FK)",
        "DELETE FROM public.preset_deck_cards;",
        "DELETE FROM public.card_art;",
        "DELETE FROM public.preset_decks;",
        "DELETE FROM public.cards;",
        "",
    ]

    # cards
    lines.append(f"-- === cards ({len(cards)} rows) ===")
    for num, card in enumerate(cards, start=1):
        sqlite_id = card["id"]
        pg_id = id_map[sqlite_id]
        is_rainbow = bool(card.get("is_rainbow")) or card.get("land_type") == "rainbow" or card.get("cost") == 0
        land_type = map_land_type(card.get("land_type"), is_rainbow)
        hero = extract_hero(card.get("tags"))
        image_url = image_urls.get(sqlite_id)
        if not image_url and supabase_url:
            image_url = storage_public_url(supabase_url, f"cards/{pg_id}.png")

        lines.append(
            "INSERT INTO public.cards "
            "(id, card_number, name, card_type, cost, attack, health, land_type, "
            "is_rainbow, has_flip, flip_description, description, image_url, "
            "mechanics, rarity, source, hero, notes) VALUES ("
            f"{sql_str(pg_id)}::uuid, {num}, {sql_str(card['name'])}, "
            f"{sql_str(card['card_type'])}, {card.get('cost') or 0}, "
            f"{card.get('attack') or 0}, {card.get('health') or 0}, "
            f"{sql_str(land_type)}, {sql_bool(is_rainbow)}, "
            f"{sql_bool(bool(card.get('has_flip')))}, "
            f"{sql_str(card.get('flip_description'))}, "
            f"{sql_str(card.get('description'))}, "
            f"{sql_str(image_url)}, "
            f"{sql_json(card.get('mechanics'))}, "
            f"{sql_str(card.get('rarity'))}, "
            f"{sql_str(card.get('source'))}, "
            f"{sql_str(hero)}, "
            "NULL);"
        )

    lines.append("")
    lines.append(f"-- === card_art ({len(card_art)} rows) ===")
    for art in card_art:
        pg_card_id = id_map.get(art["card_id"])
        if not pg_card_id:
            continue
        pg_art_id = hex_to_uuid(art["id"]) if art.get("id") else str(uuid.uuid4())
        source_url = art.get("source_url") or ""
        lines.append(
            "INSERT INTO public.card_art "
            "(id, card_id, source_url, source_kind, is_primary) VALUES ("
            f"{sql_str(pg_art_id)}::uuid, {sql_str(pg_card_id)}::uuid, "
            f"{sql_str(source_url)}, 'local', {sql_bool(bool(art.get('is_primary')))});"
        )

    lines.append("")
    lines.append(f"-- === preset_decks ({len(preset_decks)} rows) ===")
    deck_id_map: dict[str, str] = {}
    for deck in preset_decks:
        pg_id = hex_to_uuid(deck["id"])
        deck_id_map[deck["id"]] = pg_id
        landscapes = deck.get("landscapes") or "[]"
        lines.append(
            "INSERT INTO public.preset_decks "
            "(id, slug, name, hero_slug, mode, landscapes, description, is_active, sort_order) VALUES ("
            f"{sql_str(pg_id)}::uuid, {sql_str(deck['slug'])}, {sql_str(deck['name'])}, "
            f"{sql_str(deck['hero_slug'])}, {sql_str(deck.get('mode') or 'standard')}, "
            f"{sql_json(landscapes)}, {sql_str(deck.get('description'))}, "
            f"{sql_bool(bool(deck.get('is_active', 1)))}, {deck.get('sort_order') or 0});"
        )

    lines.append("")
    lines.append(f"-- === preset_deck_cards ({len(preset_deck_cards)} rows) ===")
    for row in preset_deck_cards:
        pg_deck = deck_id_map.get(row["preset_deck_id"])
        pg_card = id_map.get(row["card_id"])
        if not pg_deck or not pg_card:
            continue
        lines.append(
            "INSERT INTO public.preset_deck_cards "
            "(preset_deck_id, card_id, slot, is_landscape) VALUES ("
            f"{sql_str(pg_deck)}::uuid, {sql_str(pg_card)}::uuid, "
            f"{row['slot']}, false);"
        )

    lines.extend(["", "COMMIT;", ""])
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Export cards.db → Supabase SQL")
    parser.add_argument("--dry-run", action="store_true", help="Только статистика, без записи файлов")
    parser.add_argument("--upload-images", action="store_true", help="Загрузить PNG в Supabase Storage")
    parser.add_argument("--db", type=Path, default=DB_PATH)
    parser.add_argument("--out", type=Path, default=SQL_OUT)
    args = parser.parse_args()

    if not args.db.is_file():
        print(f"ERROR: DB not found: {args.db}", file=sys.stderr)
        sys.exit(1)

    con = sqlite3.connect(args.db)
    cards, preset_decks, preset_deck_cards, card_art = load_catalog(con)
    con.close()

    id_map = {c["id"]: hex_to_uuid(c["id"]) for c in cards}

    # Stats
    land_types = {}
    for c in cards:
        lt = c.get("land_type") or "any"
        land_types[lt] = land_types.get(lt, 0) + 1
    with_art = sum(1 for c in cards if c.get("_art_path"))
    print(f"Cards: {len(cards)}")
    print(f"With local art: {with_art}")
    print(f"Land types (raw): {land_types}")
    print(f"Preset decks: {len(preset_decks)}, slots: {len(preset_deck_cards)}")

    supabase_url = resolve_supabase_url()
    image_urls: dict[str, str] = {}

    if args.upload_images:
        validate_supabase_url(supabase_url)
        service_key = resolve_service_key()
        validate_service_key(service_key)
        print("Uploading images...")
        image_urls = upload_images(cards, id_map, supabase_url, service_key)
        print(f"Uploaded: {len(image_urls)}")

    sql = build_sql(
        cards, preset_decks, preset_deck_cards, card_art,
        id_map, image_urls, supabase_url or None,
    )

    if args.dry_run:
        print(f"\nDry run — SQL would be {len(sql)} chars, {sql.count('INSERT')} INSERTs")
        return

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(sql, encoding="utf-8")
    MAP_OUT.write_text(
        json.dumps({"sqlite_to_uuid": id_map, "generated_at": datetime.now(timezone.utc).isoformat()}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"\nWritten: {args.out}")
    print(f"Written: {MAP_OUT}")
    print("\nNext steps:")
    print("  1. python scripts/generate_supabase_batches.py")
    print("  2. python scripts/push_supabase_batches.py   # uses .env.secure token")
    print("  3. (optional) add SUPABASE_SERVICE_KEY to .env.secure, then --upload-images")


if __name__ == "__main__":
    main()
