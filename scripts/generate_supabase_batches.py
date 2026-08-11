"""Generate batched SQL files for Supabase MCP import."""
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from export_cards_to_supabase import (  # noqa: E402
    extract_hero,
    hex_to_uuid,
    load_catalog,
    map_land_type,
    sql_bool,
    sql_json,
    sql_str,
)

OUT = ROOT / "data" / "supabase_batches"
BATCH = 40


def write_batch(name: str, statements: list[str]) -> None:
    path = OUT / f"{name}.sql"
    path.write_text("\n".join(statements), encoding="utf-8")
    print(f"{name}: {path.stat().st_size} bytes")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    con = sqlite3.connect(ROOT / "data" / "cards.db")
    cards, preset_decks, preset_deck_cards, card_art = load_catalog(con)
    con.close()

    id_map = {c["id"]: hex_to_uuid(c["id"]) for c in cards}
    deck_id_map = {d["id"]: hex_to_uuid(d["id"]) for d in preset_decks}

    write_batch(
        "00_cleanup",
        [
            "DELETE FROM public.preset_deck_cards;",
            "DELETE FROM public.card_art;",
            "DELETE FROM public.preset_decks;",
            "DELETE FROM public.cards;",
        ],
    )

    card_rows = []
    for num, card in enumerate(cards, start=1):
        sqlite_id = card["id"]
        pg_id = id_map[sqlite_id]
        is_rainbow = (
            bool(card.get("is_rainbow"))
            or card.get("land_type") == "rainbow"
            or card.get("cost") == 0
        )
        land_type = map_land_type(card.get("land_type"), is_rainbow)
        hero = extract_hero(card.get("tags"))
        card_rows.append(
            f"({sql_str(pg_id)}::uuid, {num}, {sql_str(card['name'])}, {sql_str(card['card_type'])}, "
            f"{card.get('cost') or 0}, {card.get('attack') or 0}, {card.get('health') or 0}, "
            f"{sql_str(land_type)}, {sql_bool(is_rainbow)}, {sql_bool(bool(card.get('has_flip')))}, "
            f"{sql_str(card.get('flip_description'))}, {sql_str(card.get('description'))}, NULL, "
            f"{sql_json(card.get('mechanics'))}, {sql_str(card.get('rarity'))}, "
            f"{sql_str(card.get('source'))}, {sql_str(hero)}, NULL)"
        )

    for i in range(0, len(card_rows), BATCH):
        chunk = card_rows[i : i + BATCH]
        n = i // BATCH + 1
        sql = (
            "INSERT INTO public.cards (id, card_number, name, card_type, cost, attack, health, "
            "land_type, is_rainbow, has_flip, flip_description, description, image_url, "
            "mechanics, rarity, source, hero, notes) VALUES\n"
            + ",\n".join(chunk)
            + ";"
        )
        write_batch(f"01_cards_{n:02d}", [sql])

    deck_vals = []
    for deck in preset_decks:
        pg_id = deck_id_map[deck["id"]]
        deck_vals.append(
            f"({sql_str(pg_id)}::uuid, {sql_str(deck['slug'])}, {sql_str(deck['name'])}, "
            f"{sql_str(deck['hero_slug'])}, {sql_str(deck.get('mode') or 'standard')}, "
            f"{sql_json(deck.get('landscapes') or '[]')}, {sql_str(deck.get('description'))}, "
            f"{sql_bool(bool(deck.get('is_active', 1)))}, {deck.get('sort_order') or 0})"
        )
    write_batch(
        "02_preset_decks",
        [
            "INSERT INTO public.preset_decks "
            "(id, slug, name, hero_slug, mode, landscapes, description, is_active, sort_order) VALUES\n"
            + ",\n".join(deck_vals)
            + ";"
        ],
    )

    slot_vals = []
    for row in preset_deck_cards:
        pg_deck = deck_id_map.get(row["preset_deck_id"])
        pg_card = id_map.get(row["card_id"])
        if pg_deck and pg_card:
            slot_vals.append(
                f"({sql_str(pg_deck)}::uuid, {sql_str(pg_card)}::uuid, {row['slot']}, false)"
            )

    for i in range(0, len(slot_vals), BATCH):
        chunk = slot_vals[i : i + BATCH]
        n = i // BATCH + 1
        sql = (
            "INSERT INTO public.preset_deck_cards (preset_deck_id, card_id, slot, is_landscape) VALUES\n"
            + ",\n".join(chunk)
            + ";"
        )
        write_batch(f"03_preset_slots_{n:02d}", [sql])

    art_vals = []
    for art in card_art:
        pg_card = id_map.get(art["card_id"])
        if not pg_card:
            continue
        pg_art_id = hex_to_uuid(art["id"]) if art.get("id") else hex_to_uuid(art["card_id"] + "art")
        art_vals.append(
            f"({sql_str(pg_art_id)}::uuid, {sql_str(pg_card)}::uuid, {sql_str(art.get('source_url') or '')}, "
            f"'local', {sql_bool(bool(art.get('is_primary')))})"
        )

    for i in range(0, len(art_vals), BATCH):
        chunk = art_vals[i : i + BATCH]
        n = i // BATCH + 1
        sql = (
            "INSERT INTO public.card_art (id, card_id, source_url, source_kind, is_primary) VALUES\n"
            + ",\n".join(chunk)
            + ";"
        )
        write_batch(f"04_card_art_{n:02d}", [sql])

    print(f"Done: {OUT}")


if __name__ == "__main__":
    main()
