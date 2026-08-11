"""
fix_art_paths.py — детерминированная починка card_art по preset_deck_cards.

Удаляет дубликаты и осиротевшие строки, пересобирает card_art 1:1 со слотами колод.
"""
import os
import sqlite3
import uuid

from build_card_catalog import DECK_REGISTRY, ROOT

DB_PATH = r"C:\Users\<redacted>\WebstormProjects\card_game\data\cards.db"


def rel_path(*parts):
    return "/".join(parts)


def cuts_source_url(hero_slug, cuts_filename):
    set_folder, hero_folder, _, cuts_prefix, _, _ = DECK_REGISTRY[hero_slug]
    return rel_path(set_folder, hero_folder, "cuts", cuts_filename)


def grid_for_slot(cur, hero_slug, slot):
    row = cur.execute(
        """
        SELECT grid_image_path, slot_in_grid
        FROM card_grid_scans
        WHERE hero_slug=? AND global_slot=?
        """,
        (hero_slug, slot),
    ).fetchone()
    return row if row else (None, None)


def main():
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    before = cur.execute("SELECT COUNT(*) FROM card_art").fetchone()[0]
    orphans = cur.execute(
        """
        SELECT COUNT(*) FROM card_art ca
        LEFT JOIN cards c ON c.id = ca.card_id WHERE c.id IS NULL
        """
    ).fetchone()[0]

    cur.execute("DELETE FROM card_art")
    deleted = before

    rows = cur.execute(
        """
        SELECT pd.slug, pdc.card_id, pdc.cuts_filename, pdc.slot
        FROM preset_deck_cards pdc
        JOIN preset_decks pd ON pd.id = pdc.preset_deck_id
        ORDER BY pd.slug, pdc.slot
        """
    ).fetchall()

    inserted = 0
    missing_files = []

    for slug, card_id, cuts_filename, slot in rows:
        source_url = cuts_source_url(slug, cuts_filename)
        abs_path = os.path.join(ROOT, source_url.replace("/", os.sep))
        if not os.path.isfile(abs_path):
            missing_files.append(abs_path)

        grid_path, grid_slot = grid_for_slot(cur, slug, slot)

        cur.execute(
            """
            INSERT INTO card_art
              (id, card_id, cuts_filename, deck_slug, source_url,
               grid_image_path, grid_slot, is_primary, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
            """,
            (
                uuid.uuid4().hex,
                card_id,
                cuts_filename,
                slug,
                source_url,
                grid_path,
                grid_slot,
            ),
        )
        inserted += 1

    con.commit()

    after = cur.execute("SELECT COUNT(*) FROM card_art").fetchone()[0]
    mismatch = cur.execute(
        """
        SELECT COUNT(*) FROM preset_deck_cards pdc
        JOIN preset_decks pd ON pd.id = pdc.preset_deck_id
        LEFT JOIN card_art ca ON ca.deck_slug = pd.slug
            AND ca.cuts_filename = pdc.cuts_filename
            AND ca.card_id = pdc.card_id
            AND ca.is_primary = 1
        WHERE ca.id IS NULL
        """
    ).fetchone()[0]

    con.close()

    print(f"Deleted {deleted} card_art rows")
    print(f"Inserted {inserted} card_art rows (expected 640)")
    print(f"Now in DB: {after}")
    print(f"Preset slots without primary art: {mismatch}")
    if missing_files:
        print(f"Missing files on disk: {len(missing_files)}")
        for p in missing_files[:5]:
            print(f"  - {p}")
    else:
        print("All cut files exist on disk")


if __name__ == "__main__":
    main()
