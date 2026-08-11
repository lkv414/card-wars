"""Lightweight spot-check: paths exist + grid OCR matches cards table."""
import json
import os
import sqlite3
import sys

ROOT = r"C:\Users\<redacted>\Music\Adventure Time Card Wars"
DB = r"C:\Users\<redacted>\WebstormProjects\card_game\data\cards.db"

SAMPLES = [
    ("fiona", 3),
    ("fiona", 17),
    ("fiona", 40),
    ("finn", 1),
    ("jake", 20),
    ("cake", 10),
    ("bmo", 5),
    ("marceline", 32),
]


def main():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    errors = []
    ok = 0

    print("=== SPOT CHECK: paths + grid/cards consistency ===\n")

    for hero_slug, slot in SAMPLES:
        cur.execute(
            """
            SELECT c.name, c.card_type, c.cost, c.attack, c.health, c.land_type,
                   c.description, ca.source_url, ca.cuts_filename, ca.grid_image_path, ca.grid_slot,
                   gs.ocr_json, gs.cuts_path, gs.global_slot, gs.grid_image_path AS gs_grid
            FROM preset_deck_cards pdc
            JOIN preset_decks pd ON pd.id = pdc.preset_deck_id
            JOIN cards c ON c.id = pdc.card_id
            LEFT JOIN card_art ca ON ca.card_id = c.id AND ca.deck_slug = pd.slug AND ca.cuts_filename = pdc.cuts_filename
            LEFT JOIN card_grid_scans gs ON gs.hero_slug = pd.slug AND gs.global_slot = pdc.slot
            WHERE pd.slug = ? AND pdc.slot = ?
            """,
            (hero_slug, slot),
        )
        row = cur.fetchone()
        if not row:
            errors.append(f"{hero_slug} slot {slot}: NOT FOUND in preset_deck_cards")
            continue

        d = dict(row)
        cuts_abs = os.path.join(ROOT, d["source_url"]) if d["source_url"] else None
        grid_rel = d["grid_image_path"] or d["gs_grid"]
        grid_abs = os.path.join(ROOT, grid_rel) if grid_rel else None

        path_ok = cuts_abs and os.path.isfile(cuts_abs)
        grid_ok = grid_abs and os.path.isfile(grid_abs)

        ocr_name = None
        if d["ocr_json"]:
            try:
                ocr = json.loads(d["ocr_json"])
                if isinstance(ocr, list) and ocr:
                    idx = (d["grid_slot"] or 1) - 1
                    if 0 <= idx < len(ocr):
                        ocr_name = ocr[idx].get("name") if isinstance(ocr[idx], dict) else None
                elif isinstance(ocr, dict):
                    ocr_name = ocr.get("name")
            except json.JSONDecodeError:
                pass

        name_match = None
        if ocr_name and d["name"]:
            name_match = ocr_name.strip().lower() == d["name"].strip().lower() or (
                ocr_name.strip().lower() in d["name"].strip().lower()
                or d["name"].strip().lower() in ocr_name.strip().lower()
            )

        status = []
        if not path_ok:
            errors.append(f"{hero_slug}#{slot}: cuts missing: {cuts_abs}")
            status.append("CUTS_MISSING")
        else:
            status.append("cuts_ok")
        if not grid_ok:
            errors.append(f"{hero_slug}#{slot}: grid missing: {grid_abs}")
            status.append("GRID_MISSING")
        else:
            status.append("grid_ok")
        if ocr_name and name_match is False:
            errors.append(f"{hero_slug}#{slot}: name mismatch DB='{d['name']}' OCR='{ocr_name}'")
            status.append("NAME_MISMATCH")
        elif ocr_name:
            status.append("name_ok")

        ok += 1
        print(f"[{hero_slug} slot {slot}] {' | '.join(status)}")
        print(f"  name: {d['name']} | type={d['card_type']} cost={d['cost']} {d['attack']}/{d['health']} land={d['land_type']}")
        desc = (d["description"] or "")[:80]
        print(f"  desc: {desc}{'...' if len(d['description'] or '') > 80 else ''}")
        print(f"  cuts: {d['cuts_filename']} -> exists={path_ok}")
        print(f"  grid: {grid_rel} -> exists={grid_ok}")
        if ocr_name:
            print(f"  grid OCR name: {ocr_name} (match={name_match})")
        print()

    # structural checks
    cur.execute("SELECT slug, COUNT(*) FROM preset_decks pd JOIN preset_deck_cards p ON p.preset_deck_id=pd.id GROUP BY slug HAVING COUNT(*)!=40")
    bad = cur.fetchall()
    for r in bad:
        errors.append(f"deck {r[0]} has {r[1]} slots (expected 40)")

    cur.execute("SELECT COUNT(*) FROM card_art ca LEFT JOIN cards c ON c.id=ca.card_id WHERE c.id IS NULL")
    orphan_art = cur.fetchone()[0]
    if orphan_art:
        errors.append(f"{orphan_art} card_art rows without cards")

    cur.execute("SELECT COUNT(*) FROM card_art WHERE source_url IS NULL OR source_url=''")
    no_url = cur.fetchone()[0]
    if no_url:
        errors.append(f"{no_url} card_art rows without source_url")

    conn.close()
    print(f"=== RESULT: {ok} samples checked, {len(errors)} issues ===")
    for e in errors:
        print(f"  ERROR: {e}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
