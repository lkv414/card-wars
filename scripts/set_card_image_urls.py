"""
set_card_image_urls.py — Проставить image_url картам из Supabase Storage.

Предполагает загрузку в bucket card-images по пути cards/{card_id}.png

  python scripts/set_card_image_urls.py
  python scripts/set_card_image_urls.py --dry-run
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECT_REF = "<supabase-project>"
SUPABASE_URL = f"https://{PROJECT_REF}.supabase.co"
STORAGE_BUCKET = os.environ.get("SUPABASE_CARD_BUCKET", "card-images")
PUBLIC_PREFIX = f"{SUPABASE_URL}/storage/v1/object/public/{STORAGE_BUCKET}/cards"
DB_QUERY_URL = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"


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


def get_keys() -> tuple[str, str]:
    env = {**load_env_file(ROOT / ".env.secure"), **os.environ}
    access = env.get("SUPABASE_ACCESS_TOKEN", "")
    service = env.get("SUPABASE_SERVICE_KEY") or env.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not access:
        print("ERROR: SUPABASE_ACCESS_TOKEN missing (.env.secure)", file=sys.stderr)
        sys.exit(1)
    if not service:
        print("ERROR: SUPABASE_SERVICE_KEY missing (.env.secure)", file=sys.stderr)
        sys.exit(1)
    return access, service


def list_stored_card_ids(service_key: str) -> set[str]:
    import requests

    headers = {"Authorization": f"Bearer {service_key}", "apikey": service_key}
    stored: set[str] = set()
    offset = 0
    while True:
        resp = requests.post(
            f"{SUPABASE_URL}/storage/v1/object/list/{STORAGE_BUCKET}",
            headers={**headers, "Content-Type": "application/json"},
            json={"prefix": "cards/", "limit": 1000, "offset": offset},
            timeout=60,
        )
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        for item in batch:
            name = item.get("name") or ""
            if name.endswith(".png"):
                stored.add(name[:-4])
        if len(batch) < 1000:
            break
        offset += 1000
    return stored


def fetch_card_ids(access_token: str) -> list[str]:
    import requests

    resp = requests.post(
        DB_QUERY_URL,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        json={"query": "SELECT id::text AS id FROM public.cards ORDER BY card_number"},
        timeout=60,
    )
    resp.raise_for_status()
    return [row["id"] for row in resp.json()]


def run_sql(access_token: str, sql: str) -> None:
    import requests

    resp = requests.post(
        DB_QUERY_URL,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        json={"query": sql},
        timeout=120,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:500]}")


def sql_str(val: str) -> str:
    return "'" + val.replace("'", "''") + "'"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--batch-size", type=int, default=50)
    args = parser.parse_args()

    access_token, service_key = get_keys()
    stored = list_stored_card_ids(service_key)
    card_ids = fetch_card_ids(access_token)
    matched = [cid for cid in card_ids if cid in stored]
    missing = [cid for cid in card_ids if cid not in stored]

    print(f"Cards in DB: {len(card_ids)}")
    print(f"PNG in storage: {len(stored)}")
    print(f"Will update image_url: {len(matched)}")
    if missing:
        print(f"Without PNG (skip): {len(missing)}")

    if args.dry_run:
        sample = matched[0] if matched else None
        if sample:
            print(f"Sample URL: {PUBLIC_PREFIX}/{sample}.png")
        return

    batch_size = args.batch_size
    for i in range(0, len(matched), batch_size):
        chunk = matched[i : i + batch_size]
        cases = "\n".join(
            f"WHEN id = {sql_str(cid)}::uuid THEN {sql_str(f'{PUBLIC_PREFIX}/{cid}.png')}"
            for cid in chunk
        )
        ids_sql = ", ".join(f"{sql_str(cid)}::uuid" for cid in chunk)
        sql = (
            "UPDATE public.cards SET image_url = CASE\n"
            f"{cases}\n"
            "END\n"
            f"WHERE id IN ({ids_sql});"
        )
        n = i // batch_size + 1
        total = (len(matched) + batch_size - 1) // batch_size
        print(f"  batch {n}/{total} ({len(chunk)} cards)...", end=" ", flush=True)
        run_sql(access_token, sql)
        print("OK")
        time.sleep(0.2)

    print("Done.")


if __name__ == "__main__":
    main()
