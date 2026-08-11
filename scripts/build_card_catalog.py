"""
build_card_catalog.py — Каталогизация Card Wars колод.

Что делает:
1. Inventory grid photos + cuts в папке hero
2. vision_analyze для каждого grid (5 фото × 8 карт = 40 слотов)
3. Матчит global_slot ↔ cuts по порядку (slot_order)
4. Upsert cards (dedup по name), card_art, preset_decks, preset_deck_cards
5. Пишет card_grid_scans для каждого слота
6. Пишет data/card_catalog_progress.json

Запуск:
  python scripts/build_card_catalog.py --hero fiona
  python scripts/build_card_catalog.py --all
  python scripts/build_card_catalog.py --hero fiona --match-only        # без OCR, только матчинг
  python scripts/build_card_catalog.py --hero fiona --skip-ocr          # пропустить vision

Требует: hermes_tools (vision_analyze), sqlite3
"""
import argparse
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import time
import uuid
from pathlib import Path

DB_PATH = r"C:\Users\<redacted>\WebstormProjects\card_game\data\cards.db"
ROOT = r"C:\Users\<redacted>\Music\Adventure Time Card Wars"
PROGRESS_PATH = r"C:\Users\<redacted>\WebstormProjects\card_game\data\card_catalog_progress.json"
REPORT_PATH = r"C:\Users\<redacted>\WebstormProjects\card_game\data\CATALOG_REPORT.md"

# ─────────────────────────────────────────────────────────────────────────────
# Справочник колод:  slug → (set_folder, hero_folder, grid_prefix, cuts_prefix,
#                              hero_name, source_code)
#
# - set_folder:    имя папки сета на диске (Cyrillic / mixed)
# - hero_folder:   имя папки героя внутри сета (Cyrillic)
# - grid_prefix:   префикс grid-файлов: {grid_prefix}_1.png ... _5.png
# - cuts_prefix:   префикс cuts-файлов: {cuts_prefix}_1.png ... _40.png
#                  (NB: обычно "{slug}_card", но бывают исключения —
#                   lady_rainicorn, ice_king, lemongrab, grand_prix, jake_2v2)
# - hero_name:     человекочитаемое имя (для preset_decks.name)
# - source_code:   код сета (CP1..CP6 / FCP6 / DBL)
# ─────────────────────────────────────────────────────────────────────────────
DECK_REGISTRY = {
    # ── CP6: Fiona vs Cake ──
    "fiona": ("Card Wars Fiona vs Cake", "фионна", "fiona",  "fiona_card",        "Fionna",                "CP6"),
    "cake":  ("Card Wars Fiona vs Cake", "кейк",   "cake",   "cake_card",         "Cake",                  "CP6"),
    # ── CP1: Finn vs Jake ──
    "finn":  ("Card Wars Finn vs Jake",  "Финн",   "finn",   "finn_card",         "Finn",                  "CP1"),
    "jake":  ("Card Wars Finn vs Jake",  "Джейк",  "jake",   "jake_card",         "Jake",                  "CP1"),
    # ── CP2: BMO vs Lady Rainicorn ──
    "bmo":   ("Card Wars BMO vs Lady Rainicorn", "БиМО",            "BMO",           "bmo_card",          "BMO",                  "CP2"),
    "ladyrainicorn": ("Card Wars BMO vs Lady Rainicorn", "Леди Ливнерог", "ladyraincorn", "lady_rainicorn_card", "Lady Rainicorn",     "CP2"),
    # ── CP4: Ice King vs Marceline ──
    "iceking":    ("Card Wars Ice King vs Marceline", "Снежный",   "iceking",   "ice_king_card",     "Ice King",             "CP4"),
    "marceline":  ("Card Wars Ice King vs Marceline", "Марселин",  "Marceline", "marceline_card",    "Marceline",            "CP4"),
    # ── CP5: Lemongrab vs Gunter ──
    "lemongrab":  ("Card Wars Lemongrab vs Gunter",  "лемонхват",  "lemon",     "lemongrab_card",    "Lemongrab",            "CP5"),
    "gunter":     ("Card Wars Lemongrab vs Gunter",  "гантер",     "gunter",    "gunter_card",       "Gunter",               "CP5"),
    # ── CP3: Princess Bubblegum vs Lumpy Space Princess ──
    "bubblegum":  ("Card Wars Princess Bubblegum vs Lumpy Space Princess", "Бубльгум", "PB",    "bubblegum_card",    "Princess Bubblegum",  "CP3"),
    "lsp":        ("Card Wars Princess Bubblegum vs Lumpy Space Princess", "Пупырка",  "LSP",   "lsp_card",          "Lumpy Space Princess", "CP3"),
    # ── Doubles Tournament ──
    "grandprix": ("Card Wars Doubles Tournament", "Doubles Tournament/ГранПри",  "GrandPrix", "grand_prix_card",   "Grand Prix",          "DBL"),
    "jake2v2":   ("Card Wars Doubles Tournament", "Doubles Tournament/Джейк 2v2", "Jake2v2",  "jake_2v2_card",    "Jake 2v2",            "DBL"),
    "monika":    ("Card Wars Doubles Tournament", "Doubles Tournament/Моника",   "Moniker",   "monika_card",       "Moniker",             "DBL"),
    "charlie":   ("Card Wars Doubles Tournament", "Doubles Tournament/Чарли",    "Charlie",   "charlie_card",      "Charlie",             "DBL"),
}


# ─────────────────────────────────────────────────────────────────────────────
# Утилиты
# ─────────────────────────────────────────────────────────────────────────────
def ensure_schema(con):
    """Создаёт card_grid_scans и views если их нет (идемпотентно)."""
    cur = con.cursor()
    cur.executescript("""
    CREATE TABLE IF NOT EXISTS card_grid_scans (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      set_folder TEXT NOT NULL,
      hero_slug TEXT NOT NULL,
      hero_folder TEXT NOT NULL,
      grid_index INTEGER NOT NULL,
      grid_image_path TEXT NOT NULL,
      slot_in_grid INTEGER NOT NULL,
      global_slot INTEGER NOT NULL,
      cuts_filename TEXT,
      cuts_path TEXT,
      ocr_json TEXT,
      match_confidence REAL,
      match_method TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_grid_scans_hero ON card_grid_scans(hero_slug);
    CREATE INDEX IF NOT EXISTS idx_grid_scans_slot ON card_grid_scans(hero_slug, global_slot);
    CREATE INDEX IF NOT EXISTS idx_grid_scans_grid ON card_grid_scans(hero_slug, grid_index, slot_in_grid);

    CREATE VIEW IF NOT EXISTS v_cards_unique AS
      SELECT * FROM cards;

    CREATE VIEW IF NOT EXISTS v_preset_decks_complete AS
      SELECT pd.*, COUNT(pdc.card_id) AS card_count
      FROM preset_decks pd
      LEFT JOIN preset_deck_cards pdc ON pdc.preset_deck_id = pd.id
      GROUP BY pd.id
      HAVING card_count = 40;
    """)
    # UNIQUE constraint для грид-сканов, чтобы можно было ON CONFLICT
    cur.execute("""
    CREATE UNIQUE INDEX IF NOT EXISTS uq_grid_scans_hero_grid_slot
    ON card_grid_scans(hero_slug, grid_index, slot_in_grid)
    """)
    con.commit()


def hero_paths(hero_slug):
    """Возвращает (set_folder, hero_folder, grid_prefix, cuts_prefix, hero_name, source_code)."""
    if hero_slug not in DECK_REGISTRY:
        raise ValueError(f"Unknown hero: {hero_slug}. Known: {list(DECK_REGISTRY)}")
    return DECK_REGISTRY[hero_slug]


def inventory_hero(hero_slug):
    """Проверяет что в hero_folder есть 5 grids + 40 cuts."""
    set_folder, hero_folder, grid_prefix, cuts_prefix, _, _ = hero_paths(hero_slug)
    hero_dir = Path(ROOT) / set_folder / hero_folder
    # Сортируем так, чтобы _1, _2, ... шли по порядку (case-insensitive)
    grids_all = sorted(hero_dir.glob(f"{grid_prefix}_*.png"))
    cuts_dir = hero_dir / "cuts"
    cuts = sorted(cuts_dir.glob(f"{cuts_prefix}_*.png")) if cuts_dir.exists() else []
    return {
        "hero_dir": hero_dir,
        "cuts_dir": cuts_dir,
        "grids": [str(p) for p in grids_all],
        "cuts": [str(p) for p in cuts],
        "grid_count": len(grids_all),
        "cuts_count": len(cuts),
        "grid_prefix": grid_prefix,
        "cuts_prefix": cuts_prefix,
    }


def ascii_copy(src_path):
    """Копирует файл с кириллицей в %TEMP% под ASCII-именем (vision иногда не любит)."""
    tmp = tempfile.mkdtemp(prefix="grid_ocr_")
    ascii_path = os.path.join(tmp, f"grid_{uuid.uuid4().hex[:8]}.png")
    shutil.copy(src_path, ascii_path)
    return ascii_path


# ─────────────────────────────────────────────────────────────────────────────
# Vision OCR
# ─────────────────────────────────────────────────────────────────────────────
GRID_PROMPT = """This is a Card Wars trading card sheet photo with exactly 8 cards in a 2x4 or 4x2 grid.
List cards in reading order (left to right, top to bottom).
For EACH of the 8 cards return a JSON array element:
{
  "slot": 1-8,
  "name": "Russian card name exactly as printed",
  "card_type": "creature|spell|building|landscape",
  "land_type": "blue|corn|nice|ice|sand|swamp|rainbow|any",
  "cost": number,
  "attack": number or 0,
  "health": number or 0,
  "is_rainbow": boolean,
  "has_flip": boolean,
  "flip_description": string or null,
  "description": "full ability text in Russian"
}
Return ONLY a JSON array of 8 objects, no commentary."""


def vision_ocr_grid(grid_path):
    """Возвращает list из 8 dict (или None при ошибке)."""
    try:
        from hermes_tools import vision_analyze
    except ImportError:
        print("  ✗ hermes_tools недоступен — пропуск OCR", file=sys.stderr)
        return None

    ascii_path = ascii_copy(grid_path)
    try:
        result = vision_analyze(image_url=ascii_path, question=GRID_PROMPT)
        text = result.get("text", "") if isinstance(result, dict) else str(result)
        # достаём JSON-массив из текста
        start = text.find("[")
        end = text.rfind("]") + 1
        if start < 0 or end <= start:
            print(f"  ✗ JSON не найден в vision ответ: {text[:200]}", file=sys.stderr)
            return None
        data = json.loads(text[start:end])
        if not isinstance(data, list):
            print("  ✗ vision вернул не массив", file=sys.stderr)
            return None
        return data
    except Exception as e:
        print(f"  ✗ vision error: {e}", file=sys.stderr)
        return None
    finally:
        try:
            os.remove(ascii_path)
            os.rmdir(os.path.dirname(ascii_path))
        except Exception:
            pass


# ─────────────────────────────────────────────────────────────────────────────
# Upsert в БД
# ─────────────────────────────────────────────────────────────────────────────
def upsert_card_by_name(cur, name, card_type, cost, attack, health, land_type,
                       is_rainbow, has_flip, flip_description, description,
                       mechanics, source, hero):
    """Возвращает id карты. Если такой name уже есть — апдейтит и возвращает существующий id."""
    cur.execute("SELECT id FROM cards WHERE name=?", (name,))
    row = cur.fetchone()
    mech_json = json.dumps(mechanics or [], ensure_ascii=False)
    tags_json = json.dumps([f"hero:{hero}"], ensure_ascii=False)
    if row:
        cid = row[0]
        cur.execute("""
            UPDATE cards SET
                card_type=COALESCE(?, card_type),
                cost=COALESCE(?, cost),
                attack=COALESCE(?, attack),
                health=COALESCE(?, health),
                land_type=COALESCE(?, land_type),
                is_rainbow=COALESCE(?, is_rainbow),
                has_flip=COALESCE(?, has_flip),
                flip_description=COALESCE(?, flip_description),
                description=COALESCE(?, description),
                mechanics=COALESCE(?, mechanics),
                source=CASE WHEN ? IS NOT NULL AND instr(source, ?)=0
                            THEN CASE WHEN source IS NULL OR source=''
                                      THEN ? ELSE source || ',' || ? END
                            ELSE source END,
                tags=COALESCE(?, tags),
                updated_at=datetime('now')
            WHERE id=?
        """, (card_type, cost, attack, health, land_type,
              1 if is_rainbow else (0 if is_rainbow is False else None),
              1 if has_flip else (0 if has_flip is False else None),
              flip_description, description, mech_json,
              source, source, source, source, tags_json, cid))
        return cid
    else:
        cid = uuid.uuid4().hex
        cur.execute("""
            INSERT INTO cards
                (id, name, card_type, cost, attack, health, land_type,
                 is_rainbow, has_flip, flip_description, description,
                 mechanics, source, tags, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        """, (cid, name, card_type, cost, attack, health, land_type,
              1 if is_rainbow else (0 if is_rainbow is False else 0),
              1 if has_flip else (0 if has_flip is False else 0),
              flip_description, description, mech_json, source, tags_json))
        return cid


def upsert_card_art(cur, card_id, cuts_filename, deck_slug, source_url,
                    grid_image_path, grid_slot):
    """UNIQUE(cuts_filename, deck_slug) — ignore на конфликт."""
    cur.execute("""
        INSERT OR IGNORE INTO card_art
            (id, card_id, cuts_filename, deck_slug, source_url,
             grid_image_path, grid_slot, is_primary, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
    """, (uuid.uuid4().hex, card_id, cuts_filename, deck_slug,
          source_url, grid_image_path, grid_slot))


def upsert_preset_deck(cur, slug, hero_slug, name, mode="standard"):
    """Возвращает id дек."""
    cur.execute("SELECT id FROM preset_decks WHERE slug=?", (slug,))
    row = cur.fetchone()
    if row:
        return row[0]
    cur.execute("""
        INSERT INTO preset_decks
            (id, slug, name, hero_slug, mode, is_active, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?, 1, 0, datetime('now'))
    """, (uuid.uuid4().hex, slug, name, hero_slug, mode))
    return cur.lastrowid


def upsert_preset_deck_card(cur, preset_deck_id, card_id, cuts_filename, slot):
    """UNIQUE(preset_deck_id, slot) — сначала удалим если был, потом INSERT."""
    cur.execute("""
        DELETE FROM preset_deck_cards WHERE preset_deck_id=? AND slot=?
    """, (preset_deck_id, slot))
    cur.execute("""
        INSERT INTO preset_deck_cards
            (id, preset_deck_id, card_id, cuts_filename, slot)
        VALUES (?, ?, ?, ?, ?)
    """, (uuid.uuid4().hex, preset_deck_id, card_id, cuts_filename, slot))


# ─────────────────────────────────────────────────────────────────────────────
# Прогресс
# ─────────────────────────────────────────────────────────────────────────────
def load_progress():
    if not os.path.exists(PROGRESS_PATH):
        return {"decks": [], "updated_at": None}
    try:
        with open(PROGRESS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"decks": [], "updated_at": None}


def save_progress(hero_slug, status, cards, grids_scanned, errors, unmatched):
    p = load_progress()
    # remove old entry for this hero
    p["decks"] = [d for d in p["decks"] if d.get("hero_slug") != hero_slug]
    p["decks"].append({
        "hero_slug": hero_slug,
        "status": status,
        "cards": cards,
        "grids_scanned": grids_scanned,
        "errors": errors,
        "unmatched": unmatched,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
    })
    p["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    os.makedirs(os.path.dirname(PROGRESS_PATH), exist_ok=True)
    with open(PROGRESS_PATH, "w", encoding="utf-8") as f:
        json.dump(p, f, ensure_ascii=False, indent=2)


# ─────────────────────────────────────────────────────────────────────────────
# Главный пайплайн
# ─────────────────────────────────────────────────────────────────────────────
def process_hero(hero_slug, skip_ocr=False, match_only=False):
    """
    Полный пайплайн для одной колоды.
    match_only: пропустить vision OCR, использовать только slot_order matching.
    """
    set_folder, hero_folder, grid_prefix, cuts_prefix, hero_name, source_code = hero_paths(hero_slug)
    inv = inventory_hero(hero_slug)
    print(f"\n=== {hero_slug} ({hero_name}) ===")
    print(f"set: {set_folder}")
    print(f"dir: {inv['hero_dir']}")
    print(f"grids: {inv['grid_count']} (ожидается 5)")
    print(f"cuts:  {inv['cuts_count']} (ожидается 40)")

    if inv["grid_count"] != 5:
        print(f"  ⚠ Ожидалось 5 grid-фото, найдено {inv['grid_count']}")
    if inv["cuts_count"] != 40:
        print(f"  ⚠ Ожидалось 40 cuts, найдено {inv['cuts_count']}")

    if inv["grid_count"] != 5 or inv["cuts_count"] != 40:
        save_progress(hero_slug, "skipped", 0, inv["grid_count"], 1,
                     [f"grid={inv['grid_count']} cuts={inv['cuts_count']}"])
        return None

    con = sqlite3.connect(DB_PATH)
    ensure_schema(con)
    cur = con.cursor()

    # Шаг 1: vision OCR на 5 гридах
    ocr_all = []  # [(grid_index, slot_in_grid, ocr_dict), ...]
    if not skip_ocr and not match_only:
        for grid_path in inv["grids"]:
            grid_index = int(Path(grid_path).stem.split("_")[-1])
            print(f"\n  ─ grid {grid_index}: {Path(grid_path).name}")
            data = vision_ocr_grid(grid_path)
            if data is None:
                print(f"  ✗ vision failed for grid {grid_index}")
                return
            if len(data) != 8:
                print(f"  ⚠ vision вернул {len(data)} карт вместо 8")
            for item in data:
                slot_in_grid = item.get("slot", len(ocr_all) % 8 + 1)
                ocr_all.append((grid_index, slot_in_grid, item))
        print(f"\n  OCR результатов: {len(ocr_all)} карт")

    # Шаг 2: запишем card_grid_scans + совместим global_slot → cuts
    matched = []  # [(global_slot, cuts_filename, ocr_dict)]
    errors = 0
    unmatched = []

    for grid_index in range(1, 6):
        grid_path = inv["grids"][grid_index - 1]
        for slot_in_grid in range(1, 9):
            global_slot = (grid_index - 1) * 8 + slot_in_grid
            cuts_filename = f"{cuts_prefix}_{global_slot}.png"
            cuts_path = os.path.join(inv["cuts_dir"], cuts_filename)
            cuts_exists = os.path.exists(cuts_path)

            # Берём OCR данные если есть
            ocr_dict = None
            for gi, si, item in ocr_all:
                if gi == grid_index and si == slot_in_grid:
                    ocr_dict = item
                    break

            # относительные пути
            grid_image_rel = os.path.relpath(grid_path, ROOT).replace("\\", "/")
            cuts_path_rel = os.path.relpath(cuts_path, ROOT).replace("\\", "/") if cuts_exists else None

            # Пишем в card_grid_scans
            ocr_json = json.dumps(ocr_dict, ensure_ascii=False) if ocr_dict else None
            match_method = "slot_order" if cuts_exists else None
            match_conf = 1.0 if cuts_exists else None

            cur.execute("""
                INSERT OR REPLACE INTO card_grid_scans
                    (id, set_folder, hero_slug, hero_folder, grid_index,
                     grid_image_path, slot_in_grid, global_slot,
                     cuts_filename, cuts_path, ocr_json,
                     match_confidence, match_method, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            """, (uuid.uuid4().hex, set_folder, hero_slug, hero_folder,
                  grid_index, grid_image_rel, slot_in_grid, global_slot,
                  cuts_filename if cuts_exists else None,
                  cuts_path_rel, ocr_json,
                  match_conf, match_method))

            if cuts_exists:
                matched.append((global_slot, cuts_filename, ocr_dict))
            else:
                unmatched.append(global_slot)
                errors += 1

    con.commit()
    print(f"  card_grid_scans: 40 строк (unmatched: {len(unmatched)})")

    # Шаг 3: upsert cards + card_art + preset_deck_cards
    preset_deck_id = upsert_preset_deck(cur, hero_slug, hero_slug, hero_name)

    new_cards = 0
    updated_cards = 0
    for global_slot, cuts_filename, ocr_dict in matched:
        if not ocr_dict:
            # если OCR не делали — оставим имя как есть, возьмём из preset_deck_cards
            cur.execute("""
                SELECT c.name FROM preset_deck_cards pdc
                JOIN cards c ON pdc.card_id=c.id
                WHERE pdc.preset_deck_id=? AND pdc.slot=?
            """, (preset_deck_id, global_slot))
            row = cur.fetchone()
            existing_name = row[0] if row else None
            if not existing_name:
                unmatched.append(global_slot)
                continue
            # если существующее имя, используем его
            ocr_dict = {"name": existing_name}

        name = ocr_dict.get("name") or f"UNKNOWN_{hero_slug}_{global_slot}"
        card_type = ocr_dict.get("card_type")
        land_type = ocr_dict.get("land_type")
        cost = ocr_dict.get("cost")
        attack = ocr_dict.get("attack") or 0
        health = ocr_dict.get("health") or 0
        is_rainbow = bool(ocr_dict.get("is_rainbow")) if ocr_dict.get("is_rainbow") is not None else False
        has_flip = bool(ocr_dict.get("has_flip")) if ocr_dict.get("has_flip") is not None else False
        flip_description = ocr_dict.get("flip_description")
        description = ocr_dict.get("description")
        mechanics = ocr_dict.get("mechanics") or []

        # Проверка: был ли уже такой card
        cur.execute("SELECT id FROM cards WHERE name=?", (name,))
        existed = cur.fetchone() is not None

        card_id = upsert_card_by_name(
            cur, name, card_type, cost, attack, health, land_type,
            is_rainbow, has_flip, flip_description, description,
            mechanics, source_code, hero_slug,
        )
        if existed:
            updated_cards += 1
        else:
            new_cards += 1

        # Card art
        source_url = os.path.relpath(
            os.path.join(inv["cuts_dir"], cuts_filename), ROOT
        ).replace("\\", "/")
        cur.execute("""
            SELECT grid_image_path FROM card_grid_scans
            WHERE hero_slug=? AND global_slot=?
        """, (hero_slug, global_slot))
        grow = cur.fetchone()
        grid_image_rel = grow[0] if grow else None
        grid_slot = ((global_slot - 1) % 8) + 1

        upsert_card_art(cur, card_id, cuts_filename, hero_slug,
                        source_url, grid_image_rel, grid_slot)

        # Preset deck slot
        upsert_preset_deck_card(cur, preset_deck_id, card_id, cuts_filename, global_slot)

    con.commit()

    # Финальные счётчики
    cards_count = cur.execute("""
        SELECT COUNT(DISTINCT card_id) FROM preset_deck_cards WHERE preset_deck_id=?
    """, (preset_deck_id,)).fetchone()[0]
    slots_count = cur.execute("""
        SELECT COUNT(*) FROM preset_deck_cards WHERE preset_deck_id=?
    """, (preset_deck_id,)).fetchone()[0]
    grid_rows = cur.execute("""
        SELECT COUNT(*) FROM card_grid_scans WHERE hero_slug=?
    """, (hero_slug,)).fetchone()[0]

    print(f"\n  Итог {hero_slug}:")
    print(f"    card_grid_scans: {grid_rows}")
    print(f"    preset_deck_cards: {slots_count} (unique cards: {cards_count})")
    print(f"    new cards: {new_cards}, updated: {updated_cards}")
    print(f"    unmatched slots: {len(unmatched)}")

    con.close()

    # Save progress
    status = "done" if not unmatched else "partial"
    save_progress(hero_slug, status, cards_count, 5, errors, unmatched)

    return {
        "hero_slug": hero_slug,
        "grid_rows": grid_rows,
        "slots": slots_count,
        "unique_cards": cards_count,
        "unmatched": unmatched,
        "errors": errors,
    }


def cmd_all(skip_ocr=False, match_only=False):
    for slug in DECK_REGISTRY:
        try:
            process_hero(slug, skip_ocr=skip_ocr, match_only=match_only)
        except AssertionError as e:
            print(f"  SKIP {slug}: {e}")
        except Exception as e:
            print(f"  ERROR {slug}: {e}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hero", help="process one hero (slug)")
    ap.add_argument("--all", action="store_true", help="process all heroes")
    ap.add_argument("--match-only", action="store_true", help="skip OCR, slot_order match only")
    ap.add_argument("--skip-ocr", action="store_true", help="alias for --match-only")
    args = ap.parse_args()

    if args.all:
        cmd_all(skip_ocr=args.skip_ocr or args.match_only,
                match_only=args.match_only)
    elif args.hero:
        process_hero(args.hero, skip_ocr=args.skip_ocr or args.match_only,
                      match_only=args.match_only)
    else:
        ap.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()