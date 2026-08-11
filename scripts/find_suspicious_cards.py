"""Find suspicious card catalog rows for manual / targeted OCR review."""
import json
import os
import sqlite3

DB = r"C:\Users\<redacted>\WebstormProjects\card_game\data\cards.db"
ROOT = r"C:\Users\<redacted>\Music\Adventure Time Card Wars"
OUT = r"C:\Users\<redacted>\WebstormProjects\card_game\data\SUSPICIOUS_CARDS.md"


def main():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    sections = []

    # 1. Creatures with 0/0 stats (likely missed ATK/DEF from OCR)
    cur.execute("""
        SELECT c.id, c.name, c.cost, c.land_type, c.source, c.description,
               GROUP_CONCAT(DISTINCT pd.slug) AS decks
        FROM cards c
        JOIN preset_deck_cards pdc ON pdc.card_id = c.id
        JOIN preset_decks pd ON pd.id = pdc.preset_deck_id
        WHERE c.card_type = 'creature' AND c.attack = 0 AND c.health = 0
        GROUP BY c.id
        ORDER BY c.name
    """)
    zero_stats = [dict(r) for r in cur.fetchall()]
    sections.append(("creatures_0_0", zero_stats))

    # 2. Creatures with only one stat zero (unusual)
    cur.execute("""
        SELECT c.id, c.name, c.attack, c.health, c.cost, GROUP_CONCAT(DISTINCT pd.slug) AS decks
        FROM cards c
        JOIN preset_deck_cards pdc ON pdc.card_id = c.id
        JOIN preset_decks pd ON pd.id = pdc.preset_deck_id
        WHERE c.card_type = 'creature'
          AND ((c.attack = 0 AND c.health > 0) OR (c.attack > 0 AND c.health = 0))
        GROUP BY c.id
        ORDER BY c.name
    """)
    partial_zero = [dict(r) for r in cur.fetchall()]
    sections.append(("creatures_partial_zero", partial_zero))

    # 3. Missing description (except landscapes / known flip-only)
    cur.execute("""
        SELECT c.id, c.name, c.card_type, c.has_flip, c.flip_description,
               GROUP_CONCAT(DISTINCT pd.slug) AS decks
        FROM cards c
        JOIN preset_deck_cards pdc ON pdc.card_id = c.id
        JOIN preset_decks pd ON pd.id = pdc.preset_deck_id
        WHERE (c.description IS NULL OR TRIM(c.description) = '')
          AND c.card_type != 'landscape'
        GROUP BY c.id
        ORDER BY c.name
    """)
    no_desc = [dict(r) for r in cur.fetchall()]
    sections.append(("missing_description", no_desc))

    # 4. preset slot vs primary art filename mismatch
    cur.execute("""
        SELECT pd.slug, pdc.slot, pdc.cuts_filename AS expected_cut,
               ca.cuts_filename AS primary_cut, c.name
        FROM preset_deck_cards pdc
        JOIN preset_decks pd ON pd.id = pdc.preset_deck_id
        JOIN cards c ON c.id = pdc.card_id
        LEFT JOIN card_art ca ON ca.card_id = c.id
            AND ca.deck_slug = pd.slug AND ca.cuts_filename = pdc.cuts_filename
        WHERE pdc.cuts_filename != ca.cuts_filename OR ca.cuts_filename IS NULL
        ORDER BY pd.slug, pdc.slot
    """)
    art_mismatch = [dict(r) for r in cur.fetchall()]
    sections.append(("art_primary_mismatch", art_mismatch))

    # 5. preset cut exists but no card_art row for that exact filename
    cur.execute("""
        SELECT pd.slug, pdc.slot, pdc.cuts_filename, c.name
        FROM preset_deck_cards pdc
        JOIN preset_decks pd ON pd.id = pdc.preset_deck_id
        JOIN cards c ON c.id = pdc.card_id
        WHERE NOT EXISTS (
            SELECT 1 FROM card_art ca
            WHERE ca.deck_slug = pd.slug
              AND ca.cuts_filename = pdc.cuts_filename
              AND ca.card_id = pdc.card_id
        )
        ORDER BY pd.slug, pdc.slot
    """)
    missing_art_row = [dict(r) for r in cur.fetchall()]
    sections.append(("missing_art_row", missing_art_row))

    # 6. Orphan card_art (no card)
    cur.execute("""
        SELECT ca.deck_slug, ca.cuts_filename, ca.source_url
        FROM card_art ca
        LEFT JOIN cards c ON c.id = ca.card_id
        WHERE c.id IS NULL
        ORDER BY ca.deck_slug, ca.cuts_filename
        LIMIT 100
    """)
    orphan_art = [dict(r) for r in cur.fetchall()]
    sections.append(("orphan_art", orphan_art))

    # 7. Grid OCR name != cards.name (fuzzy)
    name_mismatch = []
    cur.execute("""
        SELECT gs.hero_slug, gs.global_slot, gs.cuts_filename, gs.ocr_json, c.name AS db_name, c.id
        FROM card_grid_scans gs
        JOIN preset_deck_cards pdc ON pdc.slot = gs.global_slot
        JOIN preset_decks pd ON pd.id = pdc.preset_deck_id AND pd.slug = gs.hero_slug
        JOIN cards c ON c.id = pdc.card_id
        WHERE gs.ocr_json IS NOT NULL
    """)
    for row in cur.fetchall():
        r = dict(row)
        try:
            ocr = json.loads(r["ocr_json"])
            if isinstance(ocr, list):
                idx = ((r["global_slot"] - 1) % 8)
                ocr_name = (ocr[idx].get("name") if idx < len(ocr) and isinstance(ocr[idx], dict) else None)
            elif isinstance(ocr, dict):
                ocr_name = ocr.get("name")
            else:
                ocr_name = None
        except (json.JSONDecodeError, TypeError, IndexError):
            ocr_name = None
        if not ocr_name or not r["db_name"]:
            continue
        a, b = ocr_name.strip().lower(), r["db_name"].strip().lower()
        if a != b and a not in b and b not in a:
            name_mismatch.append({
                "hero_slug": r["hero_slug"],
                "slot": r["global_slot"],
                "cuts": r["cuts_filename"],
                "ocr_name": ocr_name,
                "db_name": r["db_name"],
            })
    sections.append(("grid_name_mismatch", name_mismatch))

    # 8. Same name, different stats (possible duplicate merge error)
    cur.execute("""
        SELECT name, COUNT(DISTINCT attack || '/' || health || '/' || cost) AS stat_variants,
               GROUP_CONCAT(DISTINCT attack || '/' || health) AS stats
        FROM cards
        WHERE card_type = 'creature'
        GROUP BY name
        HAVING stat_variants > 1
        ORDER BY name
    """)
    dup_stats = [dict(r) for r in cur.fetchall()]
    sections.append(("same_name_different_stats", dup_stats))

    # Build markdown report
    lines = [
        "# Suspicious cards report",
        "",
        "Критерии «подозрительности» — эвристики, не 100% ошибки.",
        "",
        "## Summary",
        "",
    ]
    for key, rows in sections:
        lines.append(f"- **{key}**: {len(rows)}")

    for key, rows in sections:
        lines.append("")
        lines.append(f"## {key} ({len(rows)})")
        lines.append("")
        if not rows:
            lines.append("_none_")
            continue
        if key == "creatures_0_0":
            lines.append("| name | cost | land | decks |")
            lines.append("|------|-----:|------|-------|")
            for r in rows[:80]:
                lines.append(f"| {r['name']} | {r['cost']} | {r['land_type']} | {r['decks']} |")
            if len(rows) > 80:
                lines.append(f"\n_...and {len(rows)-80} more_")
        elif key == "grid_name_mismatch":
            lines.append("| deck | slot | OCR name | DB name | cut |")
            lines.append("|------|-----:|----------|---------|-----|")
            for r in rows[:50]:
                lines.append(f"| {r['hero_slug']} | {r['slot']} | {r['ocr_name']} | {r['db_name']} | {r['cuts']} |")
        elif key == "art_primary_mismatch":
            lines.append("| deck | slot | expected | primary | name |")
            lines.append("|------|-----:|----------|---------|------|")
            for r in rows[:40]:
                lines.append(f"| {r['slug']} | {r['slot']} | {r['expected_cut']} | {r['primary_cut']} | {r['name']} |")
        elif key == "same_name_different_stats":
            lines.append("| name | stats variants |")
            lines.append("|------|----------------|")
            for r in rows:
                lines.append(f"| {r['name']} | {r['stats']} |")
        else:
            for r in rows[:30]:
                lines.append(f"- `{r}`")
            if len(rows) > 30:
                lines.append(f"- _...and {len(rows)-30} more_")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(f"Report: {OUT}")
    for key, rows in sections:
        print(f"  {key}: {len(rows)}")

    # Print sample cut paths for creatures_0_0 (for targeted vision)
    print("\nSample 0/0 creatures with cut path:")
    cur.execute("""
        SELECT pd.slug, pdc.slot, pdc.cuts_filename, c.name, ca.source_url
        FROM cards c
        JOIN preset_deck_cards pdc ON pdc.card_id = c.id
        JOIN preset_decks pd ON pd.id = pdc.preset_deck_id
        JOIN card_art ca ON ca.card_id = c.id AND ca.deck_slug = pd.slug
            AND ca.cuts_filename = pdc.cuts_filename
        WHERE c.card_type='creature' AND c.attack=0 AND c.health=0
        ORDER BY c.name
        LIMIT 8
    """)
    for slug, slot, cut, name, url in cur.fetchall():
        path = os.path.join(ROOT, url) if url else "?"
        print(f"  [{slug} #{slot}] {name} -> {path} ({'OK' if os.path.isfile(path) else 'MISSING'})")

    conn.close()


if __name__ == "__main__":
    main()
