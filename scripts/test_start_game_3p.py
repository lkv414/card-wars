"""Verify start_game_for_lobby works for 3 players with real card deck JSON."""
import json
import os
import sys
import urllib.request

ref = sys.argv[1]
token = os.environ["SUPABASE_ACCESS_TOKEN"]
HDR = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (SupabaseManagementAPI)",
}


def call(sql):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{ref}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers=HDR,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


# 1) insert lobby
status, rows = call(
    "SELECT set_config('app.guest_id', 'g-test-3p-12345678', true); "
    "INSERT INTO public.lobbies (code, host_id) VALUES ('TST3P2', 'g-test-3p-12345678') "
    "RETURNING id::text AS lobby_id;"
)
print("lobby insert", status, rows)
lobby_id = rows[0]["lobby_id"]

# 2) pick real cards
status, cards = call(
    "SELECT id::text, name, cost, attack, health, description, image_url, card_type, "
    "has_flip, flip_description, land_type, is_rainbow, mechanics "
    "FROM public.cards ORDER BY cost LIMIT 6"
)
print("cards fetched", status, len(cards))


def build_deck():
    instances = []
    for card in cards:
        c = dict(card)
        c["quantity"] = 1
        instances.append(c)
    lands = []
    for _ in range(4):
        lc = dict(cards[0])
        lc["land_type"] = "any"
        lands.append(lc)
    return {
        "code": "DK-TEST3P",
        "name": "TestDeck",
        "selectedCards": {},
        "selectedLands": {},
        "cards": instances,
        "lands": lands,
        "cardCount": len(instances),
        "landCount": 4,
    }


deck_json = json.dumps(build_deek := build_deck())
for pid in ("g-test-3p-p2-12345", "g-test-3p-p3-12345"):
    sql = (
        f"SELECT set_config('app.guest_id', 'g-test-3p-12345678', true); "
        f"INSERT INTO public.lobby_players (lobby_id, player_id, deck) "
        f"VALUES ('{lobby_id}', '{pid}', '{deck_json}'::jsonb);"
    )
    status, out = call(sql)
    print(f"insert player {pid}", status, str(out)[:200])

# 3) start game
status, out = call(
    f"SELECT public.start_game_for_lobby('g-test-3p-12345678', '{lobby_id}')::text AS game_id;"
)
print("start_game", status, str(out)[:200])

# 4) inspect players
status, out = call(
    f"SELECT player_id, position, player_order FROM public.game_players "
    f"WHERE game_id = (SELECT id FROM public.games WHERE lobby_id = '{lobby_id}') "
    "ORDER BY player_order;"
)
print("game_players", status, out)

# 5) cleanup
status, out = call(f"DELETE FROM public.lobbies WHERE id = '{lobby_id}';")
print("cleanup lobby", status, str(out)[:200])
