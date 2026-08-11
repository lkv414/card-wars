"""
push_supabase_batches.py — Загрузка batched SQL в Supabase через Management API.

Использует SUPABASE_ACCESS_TOKEN из .env.secure (не service_role).

  python scripts/generate_supabase_batches.py
  python scripts/push_supabase_batches.py
  python scripts/push_supabase_batches.py --dry-run
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BATCH_DIR = ROOT / "data" / "supabase_batches"
PROJECT_REF = "<supabase-project>"
API_URL = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"


def load_token() -> str:
    secure = ROOT / ".env.secure"
    if secure.is_file():
        for line in secure.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("SUPABASE_ACCESS_TOKEN="):
                return line.split("=", 1)[1].strip()
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if not token:
        print("ERROR: SUPABASE_ACCESS_TOKEN not found in .env.secure or env", file=sys.stderr)
        sys.exit(1)
    if token in ("your_token", "sbp_xxx"):
        print("ERROR: replace placeholder SUPABASE_ACCESS_TOKEN in .env.secure", file=sys.stderr)
        sys.exit(1)
    return token


def run_query(token: str, sql: str) -> None:
    try:
        import requests
    except ImportError:
        print("ERROR: pip install requests", file=sys.stderr)
        sys.exit(1)

    resp = requests.post(
        API_URL,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={"query": sql},
        timeout=120,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:500]}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--dir", type=Path, default=BATCH_DIR)
    args = parser.parse_args()

    files = sorted(args.dir.glob("*.sql"))
    if not files:
        print(f"ERROR: no SQL files in {args.dir}. Run generate_supabase_batches.py first.", file=sys.stderr)
        sys.exit(1)

    if args.dry_run:
        print(f"Would run {len(files)} batches from {args.dir}")
        for f in files:
            print(f"  {f.name} ({f.stat().st_size} bytes)")
        return

    token = load_token()
    print(f"Pushing {len(files)} batches to {PROJECT_REF}...")

    for i, path in enumerate(files, start=1):
        sql = path.read_text(encoding="utf-8")
        print(f"  [{i}/{len(files)}] {path.name}...", end=" ", flush=True)
        try:
            run_query(token, sql)
            print("OK")
        except Exception as exc:
            print("FAIL")
            print(f"ERROR in {path.name}: {exc}", file=sys.stderr)
            sys.exit(1)
        time.sleep(0.3)

    print("Done.")


if __name__ == "__main__":
    main()
