"""
ocr_all_cards.py — запись OCR-результатов в БД.

Использование:
  python scripts/ocr_all_cards.py write-batch '<json>'
  python scripts/ocr_all_cards.py status
  python scripts/ocr_all_cards.py export-pending

JSON-формат для write-batch:
[
  {
    "cuts_filename": "bmo_card_1.png",
    "name": "Костяная палочка",
    "card_type": "creature",
    "cost": 0,
    "attack": 0,
    "health": 0,
    "land_type": "rainbow",
    "is_rainbow": true,
    "has_flip": false,
    "flip_description": null,
    "description": "..."
  }
]
"""
import sys
import os
import json
import sqlite3
import uuid

DB_PATH = r"C:\Users\<redacted>\WebstormProjects\card_game\data\cards.db"
ROOT = r"C:\Users\<redacted>\Music\Adventure Time Card Wars"


def find_or_create_card(cur, name, card_type, cost, attack, health, land_type,
                       is_rainbow, has_flip, flip_description, description):
    """Найти карту по name. Если нет — создать."""
    cur.execute("SELECT id FROM cards WHERE name=?", (name,))
    row = cur.fetchone()
    if row:
        cid = row[0]
    else:
        cid = uuid.uuid4().hex
        cur.execute("""
            INSERT INTO cards (id, name, created_at, updated_at)
            VALUES (?, ?, datetime('now'), datetime('now'))
        """, (cid, name))
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
            updated_at=datetime('now')
        WHERE id=?
    """, (
        card_type, cost, attack, health, land_type,
        1 if is_rainbow else (0 if is_rainbow is False else None),
        1 if has_flip else (0 if has_flip is False else None),
        flip_description, description,
        cid,
    ))
    return cid


def remap_art_pdc(cur, card_id, cuts_filename):
    """Перепривязать card_art и preset_deck_cards к новой card_id для ВСЕХ
    записей с этим cuts_filename (включая те что указывают на placeholder)."""
    cur.execute("""
        UPDATE card_art SET card_id=?
        WHERE cuts_filename=?
          AND card_id IN (SELECT id FROM cards WHERE name LIKE 'PENDING_OCR_%')
    """, (card_id, cuts_filename))
    cur.execute("""
        UPDATE preset_deck_cards SET card_id=?
        WHERE cuts_filename=?
          AND card_id IN (SELECT id FROM cards WHERE name LIKE 'PENDING_OCR_%')
    """, (card_id, cuts_filename))


def cleanup_orphans(cur):
    """Удалить PENDING_OCR карты, на которые больше никто не ссылается."""
    cur.execute("""
        DELETE FROM cards WHERE name LIKE 'PENDING_OCR_%'
          AND id NOT IN (SELECT DISTINCT card_id FROM card_art)
          AND id NOT IN (SELECT DISTINCT card_id FROM preset_deck_cards)
    """)


def cmd_write_batch(payload_json):
    data = json.loads(payload_json)
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    written = 0
    for item in data:
        cuts = item.get("cuts_filename")
        name = item.get("name") or f"UNKNOWN_{cuts}"
        if not cuts:
            continue
        card_id = find_or_create_card(
            cur,
            name=name,
            card_type=item.get("card_type"),
            cost=item.get("cost"),
            attack=item.get("attack"),
            health=item.get("health"),
            land_type=item.get("land_type"),
            is_rainbow=item.get("is_rainbow"),
            has_flip=item.get("has_flip"),
            flip_description=item.get("flip_description"),
            description=item.get("description"),
        )
        remap_art_pdc(cur, card_id, cuts)
        written += 1
    cleanup_orphans(cur)
    con.commit()
    print(f"Written {written} OCR results")
    con.close()


def cmd_status():
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    n_total = cur.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
    n_pend = cur.execute("SELECT COUNT(*) FROM cards WHERE name LIKE 'PENDING_OCR_%'").fetchone()[0]
    n_real = n_total - n_pend
    n_with_desc = cur.execute("SELECT COUNT(*) FROM cards WHERE description IS NOT NULL AND description != ''").fetchone()[0]
    n_with_atk = cur.execute("SELECT COUNT(*) FROM cards WHERE attack IS NOT NULL AND card_type='creature' AND attack>0").fetchone()[0]
    n_creature = cur.execute("SELECT COUNT(*) FROM cards WHERE card_type='creature'").fetchone()[0]
    print(f"Total cards: {n_total}")
    print(f"  Real: {n_real}")
    print(f"  PENDING_OCR: {n_pend}")
    print(f"  with description: {n_with_desc}")
    print(f"  creatures with atk>0: {n_with_atk}/{n_creature}")
    con.close()


def cmd_export_pending():
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    rows = cur.execute("""
        SELECT DISTINCT ca.cuts_filename
        FROM card_art ca
        JOIN cards c ON ca.card_id=c.id
        WHERE c.name LIKE 'PENDING_OCR_%'
        ORDER BY ca.cuts_filename
    """).fetchall()
    for r in rows:
        print(r[0])
    con.close()


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "write-batch":
        if len(sys.argv) < 3:
            print("Usage: ocr_all_cards.py write-batch '<json>'")
            sys.exit(1)
        cmd_write_batch(sys.argv[2])
    elif cmd == "status":
        cmd_status()
    elif cmd == "export-pending":
        cmd_export_pending()
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)


if __name__ == "__main__":
    main()