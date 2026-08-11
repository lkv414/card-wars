#!/usr/bin/env python3
"""Fix 4 orphan cards: link correct art cuts, upload to Supabase, set image_url."""
from __future__ import annotations

import os
import sqlite3
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "cards.db"
IMAGE_ROOT = Path(
    os.environ.get(
        "CARD_IMAGE_ROOT",
        r"C:\Users\<redacted>\Music\Adventure Time Card Wars",
    )
)
PROJECT_REF = "<supabase-project>"
SUPABASE_URL = f"https://{PROJECT_REF}.supabase.co"
STORAGE_BUCKET = "card-images"
DB_QUERY_URL = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"

# card_number -> (sqlite_id, deck_slug, cuts_filename)
# Verified visually against card art (English headers on PNGs).
FIXES = [
    (9, "fac32a204061474ca5ab644b2d330dbc", "finn", "finn_card_11.png"),   # Psionic Architect
    (79, "0073f310c153483d9c7fc0c5a465ac61", "jake", "jake_card_6.png"),    # Field Reaper
    (337, "7262918961514952b0001cf2ca531f38", "finn", "finn_card_14.png"),  # Struzann Jinn
    (388, "d3284a2e372849f68733720f791dc2a9", "finn", "finn_card_22.png"),   # Schoolhouse
]


def hex_to_uuid(hex_id: str) -> str:
    h = hex_id.replace("-", "")
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


def load_env() -> dict[str, str]:
    out: dict[str, str] = {}
    for path in (ROOT / ".env.secure", ROOT / ".env"):
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    out.update(os.environ)
    return out


def fix_sqlite() -> list[tuple[int, str, Path, str]]:
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    uploads: list[tuple[int, str, Path, str]] = []

    for card_number, card_id, deck_slug, cuts_filename in FIXES:
        row = cur.execute(
            """
            SELECT source_url, grid_image_path, grid_slot
            FROM card_art
            WHERE deck_slug = ? AND cuts_filename = ?
            LIMIT 1
            """,
            (deck_slug, cuts_filename),
        ).fetchone()
        if not row:
            print(f"  ERROR no card_art for {deck_slug}/{cuts_filename}", file=sys.stderr)
            sys.exit(1)

        source_url = row["source_url"]
        png = IMAGE_ROOT / source_url.replace("/", os.sep)
        if not png.is_file():
            print(f"  ERROR missing PNG {png}", file=sys.stderr)
            sys.exit(1)

        cur.execute(
            """
            UPDATE card_art
            SET card_id = ?, is_primary = 1
            WHERE deck_slug = ? AND cuts_filename = ?
            """,
            (card_id, deck_slug, cuts_filename),
        )

        name = cur.execute("SELECT name FROM cards WHERE id = ?", (card_id,)).fetchone()[0]
        pg_id = hex_to_uuid(card_id)
        uploads.append((card_number, name, png, pg_id))
        print(f"  SQLite: #{card_number} {name} <- {cuts_filename}")

    con.commit()
    con.close()
    return uploads


def upload_and_update(uploads: list[tuple[int, str, Path, str]]) -> None:
    import requests

    env = load_env()
    access = env.get("SUPABASE_ACCESS_TOKEN", "")
    service = env.get("SUPABASE_SERVICE_KEY") or env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not access or not service:
        print("ERROR: need SUPABASE_ACCESS_TOKEN and SUPABASE_SERVICE_KEY in .env.secure", file=sys.stderr)
        sys.exit(1)

    headers = {"Authorization": f"Bearer {service}", "apikey": service}

    for card_number, name, png, pg_id in uploads:
        object_path = f"cards/{pg_id}.png"
        upload_url = f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/{object_path}"
        with open(png, "rb") as f:
            resp = requests.post(
                upload_url,
                headers={**headers, "Content-Type": "image/png", "x-upsert": "true"},
                data=f.read(),
                timeout=60,
            )
        if resp.status_code not in (200, 201):
            print(f"  ERROR upload #{card_number}: {resp.status_code} {resp.text[:200]}", file=sys.stderr)
            sys.exit(1)
        print(f"  Storage: uploaded {png.name} -> {object_path}")

    public = f"{SUPABASE_URL}/storage/v1/object/public/{STORAGE_BUCKET}/cards"
    cases = "\n".join(
        f"WHEN id = '{pg_id}'::uuid THEN '{public}/{pg_id}.png'"
        for _, _, _, pg_id in uploads
    )
    ids = ", ".join(f"'{pg_id}'::uuid" for _, _, _, pg_id in uploads)
    sql = f"UPDATE public.cards SET image_url = CASE\n{cases}\nEND WHERE id IN ({ids});"

    resp = requests.post(
        DB_QUERY_URL,
        headers={
            "Authorization": f"Bearer {access}",
            "Content-Type": "application/json",
        },
        json={"query": sql},
        timeout=60,
    )
    if resp.status_code >= 400:
        print(f"  ERROR SQL: {resp.status_code} {resp.text[:300]}", file=sys.stderr)
        sys.exit(1)
    print("  Supabase: image_url updated for 4 cards")


def main() -> None:
    print("Fixing orphan card art (correct PNG mapping)...")
    uploads = fix_sqlite()
    upload_and_update(uploads)
    print("Done.")


if __name__ == "__main__":
    main()
