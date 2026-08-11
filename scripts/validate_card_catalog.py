"""
validate_card_catalog.py — Проверка целостности каталога.

Запуск:
  python scripts/validate_card_catalog.py                    # все колоды
  python scripts/validate_card_catalog.py --hero fiona       # одна
  python scripts/validate_card_catalog.py --json             # вывод как JSON

Проверки:
  - 40 cuts связаны (card_art для hero_slug)
  - 40 preset_deck_cards в деке
  - 5 grid scans × 8 slots = 40 grid rows
  - Каждый card_art имеет non-null source_url
  - Нет дубликатов slots в preset_deck_cards
  - Все cuts_filename из preset_deck_cards имеют запись в card_art
  - Для каждого slot есть grid scan (cuts_filename сопоставлен)
"""
import argparse
import json
import sqlite3
import sys

DB_PATH = r"C:\Users\<redacted>\WebstormProjects\card_game\data\cards.db"
DECK_REGISTRY = {
    # CP6
    "fiona": "Fionna",
    "cake":  "Cake",
    # CP1
    "finn":  "Finn",
    "jake":  "Jake",
    # CP2
    "bmo":   "BMO",
    "ladyrainicorn": "Lady Rainicorn",
    # CP4
    "iceking": "Ice King",
    "marceline": "Marceline",
    # CP5
    "lemongrab": "Lemongrab",
    "gunter": "Gunter",
    # CP3
    "bubblegum": "Princess Bubblegum",
    "lsp": "Lumpy Space Princess",
    # DBL — Doubles Tournament
    "grandprix": "Grand Prix",
    "jake2v2":   "Jake 2v2",
    "monika":    "Moniker",
    "charlie":   "Charlie",
}


def check_hero(con, hero_slug):
    cur = con.cursor()
    errors = []
    warnings = []
    stats = {}

    # 1. preset_deck существует
    cur.execute("SELECT id FROM preset_decks WHERE slug=?", (hero_slug,))
    row = cur.fetchone()
    if not row:
        return None, [f"preset_deck с slug={hero_slug} не найден"], []
    pd_id = row[0]

    # 2. card_art: 40 строк
    n_art = cur.execute("SELECT COUNT(*) FROM card_art WHERE deck_slug=?", (hero_slug,)).fetchone()[0]
    stats["card_art_count"] = n_art
    if n_art != 40:
        errors.append(f"card_art для {hero_slug}: {n_art} (ожидается 40)")

    # 3. card_art: source_url все not null
    null_url = cur.execute("""
        SELECT COUNT(*) FROM card_art WHERE deck_slug=? AND (source_url IS NULL OR source_url='')
    """, (hero_slug,)).fetchone()[0]
    if null_url:
        errors.append(f"card_art с пустым source_url: {null_url}")

    # 4. preset_deck_cards: 40
    n_pdc = cur.execute("SELECT COUNT(*) FROM preset_deck_cards WHERE preset_deck_id=?", (pd_id,)).fetchone()[0]
    stats["preset_deck_cards_count"] = n_pdc
    if n_pdc != 40:
        errors.append(f"preset_deck_cards для {hero_slug}: {n_pdc} (ожидается 40)")

    # 5. дубликаты slots
    dups = cur.execute("""
        SELECT slot, COUNT(*) FROM preset_deck_cards WHERE preset_deck_id=?
        GROUP BY slot HAVING COUNT(*)>1
    """, (pd_id,)).fetchall()
    if dups:
        errors.append(f"дубликаты slots: {dups}")

    # 6. уникальных cards
    unique_cards = cur.execute("""
        SELECT COUNT(DISTINCT card_id) FROM preset_deck_cards WHERE preset_deck_id=?
    """, (pd_id,)).fetchone()[0]
    stats["unique_cards"] = unique_cards

    # 7. card_grid_scans: 40
    n_grids = cur.execute("SELECT COUNT(*) FROM card_grid_scans WHERE hero_slug=?", (hero_slug,)).fetchone()[0]
    stats["card_grid_scans_count"] = n_grids
    if n_grids != 40:
        errors.append(f"card_grid_scans для {hero_slug}: {n_grids} (ожидается 40)")

    # 8. грид покрытие — для каждого slot 1..40 должна быть запись
    slots_present = set(r[0] for r in cur.execute("""
        SELECT global_slot FROM card_grid_scans WHERE hero_slug=?
    """, (hero_slug,)).fetchall())
    missing_slots = sorted(set(range(1, 41)) - slots_present)
    if missing_slots:
        errors.append(f"отсутствуют global_slot в card_grid_scans: {missing_slots}")

    # 9. cuts_filename из preset_deck_cards должны быть в card_art
    missing_art = cur.execute("""
        SELECT pdc.cuts_filename FROM preset_deck_cards pdc
        LEFT JOIN card_art ca ON ca.cuts_filename=pdc.cuts_filename AND ca.deck_slug=?
        WHERE pdc.preset_deck_id=? AND ca.id IS NULL
    """, (hero_slug, pd_id)).fetchall()
    if missing_art:
        errors.append(f"cuts_filename без card_art: {len(missing_art)} ({missing_art[:5]}...)")

    # 10. card_art source_url существует на диске
    missing_files = []
    import os
    ROOT = r"C:\Users\<redacted>\Music\Adventure Time Card Wars"
    for cuts_filename, source_url in cur.execute("""
        SELECT cuts_filename, source_url FROM card_art WHERE deck_slug=?
    """, (hero_slug,)).fetchall():
        full = os.path.join(ROOT, source_url) if source_url else ""
        if not full or not os.path.exists(full):
            missing_files.append(cuts_filename)
    if missing_files:
        errors.append(f"card_art файлов не существует на диске: {len(missing_files)} ({missing_files[:5]}...)")

    # 11. slot 1..40 monotonic
    slots = [r[0] for r in cur.execute("""
        SELECT slot FROM preset_deck_cards WHERE preset_deck_id=? ORDER BY slot
    """, (pd_id,)).fetchall()]
    if slots != list(range(1, 41)):
        errors.append(f"slots не покрывают 1..40 монотонно: {slots}")

    # 12. cards без name
    n_null = cur.execute("""
        SELECT COUNT(*) FROM cards WHERE name IS NULL OR name=''
    """).fetchone()[0]
    if n_null:
        warnings.append(f"карт с пустым name: {n_null}")

    return stats, errors, warnings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hero", help="check one hero")
    ap.add_argument("--json", action="store_true", help="JSON output")
    args = ap.parse_args()

    con = sqlite3.connect(DB_PATH)

    if args.hero:
        heroes = [args.hero]
    else:
        heroes = list(DECK_REGISTRY.keys())

    results = {}
    total_errors = 0
    total_warnings = 0

    for slug in heroes:
        stats, errors, warnings = check_hero(con, slug)
        if stats is None:
            results[slug] = {"errors": errors}
            total_errors += len(errors)
            continue
        results[slug] = {
            "stats": stats,
            "errors": errors,
            "warnings": warnings,
        }
        total_errors += len(errors)
        total_warnings += len(warnings)

    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        print(f"\n=== Валидация каталога ===\n")
        for slug, r in results.items():
            if "stats" not in r:
                print(f"  ✗ {slug}: {r['errors']}")
                continue
            ok = "✓" if not r["errors"] else "✗"
            print(f"  {ok} {slug}: {r['stats']}")
            for e in r["errors"]:
                print(f"      ERROR: {e}")
            for w in r["warnings"]:
                print(f"      WARN: {w}")
        print(f"\nTotal: {total_errors} errors, {total_warnings} warnings")

    con.close()
    sys.exit(1 if total_errors else 0)


if __name__ == "__main__":
    main()
