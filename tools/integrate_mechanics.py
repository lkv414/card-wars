#!/usr/bin/env python3
"""
Integrate mechanics v2 from branch origin/v3 into content/ JSON files (Option A).

Embeds:
- "abilities": AbilitySpec[] directly into card JSON files
- "ability": AbilitySpec into hero JSON files
- "wordSetup", "flavorOnly" where applicable
- Updates content/index.json and content/index.min.json
"""

import os
import sys
import glob
import json
import re
import subprocess
import tarfile
import io
from difflib import SequenceMatcher

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT_DIR = os.path.join(ROOT_DIR, "content")

LAND_MAP = {
    'swamp': 'swamp', 'corn': 'corn', 'blue': 'blue', 'nice': 'nice', 'good': 'nice',
    'rainbow': 'rainbow', 'sand': 'sand', 'sandy': 'sand', 'ice': 'ice', 'icy': 'ice', 'lava': 'lava'
}

HERO_EXACT_MAP = {
    'hero_abracadaniel': 'abracadaniel-8760145',
    'hero_billy': 'billy-eebb206',
    'hero_bmo': 'bmo-f0dc351',
    'hero_bubblegum': 'princess-bubblegum-81b5519',
    'hero_cake': 'cake-1148c13',
    'hero_charlie': 'charlie-7b18f52',
    'hero_cosmic_owl': 'cosmic-owl-8fca998',
    'hero_finn': 'finn-d429d3e',
    'hero_fiona': 'fionna-47bc549',
    'hero_grand_prix': 'grand-prix-9bffff8',
    'hero_gunter': 'gunter-58a69d5',
    'hero_huntress_wizard': 'huntress-wizard-2a62531',
    'hero_ice_king': 'ice-king-105b469',
    'hero_jake': 'jake-e93a01c',
    'hero_jake_2v2': 'jake-2x2-0b47549',
    'hero_lady_rainicorn': 'lady-rainicorn-1ef4002',
    'hero_lemongrab': 'lemongrab-e345000',
    'hero_lsp': 'lumpy-space-princess-3b8f8e4',
    'hero_magic_man': 'magic-man-367b086',
    'hero_marceline': 'marceline-0757aa3',
    'hero_monika': 'monica-403c05b',
    'hero_prismo': 'prismo-cb00b98',
    'hero_ricardio': 'ricardio-1782ab3',
    'hero_strong_susan': 'strong-susan-9aeff38',
    'hero_tree_trunks': 'tree-trunks-7eaac7c',
}

SPECIAL_MANUAL_MAP = {
    'charlie_card_28': 'brotherhood-d81170b',
    'charlie_card_6': 'shared-contribution-495d320',
    'lsp_card_25': 'grape-djinni-ecb5d6f',
    'marceline_card_31': 'paper-tiger-4a0a661',
}

def norm_words(text):
    if not text: return set()
    t = str(text).lower().replace('ё', 'е').replace('\n', ' ')
    words = re.findall(r'[0-9a-zа-я]{3,}', t)
    return set(words)

def main():
    print("=" * 60)
    print(" INTEGRATING MECHANICS V2 INTO CONTENT/")
    print("=" * 60)

    # 1. Load our cards and heroes
    cards = []
    heroes = []
    all_items = []

    for p in glob.glob(os.path.join(CONTENT_DIR, "**", "*.json"), recursive=True):
        if "index" in p: continue
        with open(p, 'r', encoding='utf-8') as f:
            d = json.load(f)
        d['_path'] = p
        d['_words'] = norm_words(d.get('description'))
        all_items.append(d)
        if d.get('kind') == 'hero' or d.get('typeCategory') == 'hero':
            heroes.append(d)
        elif d.get('kind') == 'card' or d.get('typeCategory') in ('creature', 'spell', 'building', 'teamwork'):
            cards.append(d)

    print(f"Loaded from content/: {len(cards)} cards, {len(heroes)} heroes")

    # 2. Fast load v3 cards and mechanics via git archive
    print("Fast loading mechanics from origin/v3 via git archive...")
    p_cards = subprocess.run(['git', 'archive', 'origin/v3', 'content/cards/'], capture_output=True)
    tf_cards = tarfile.open(fileobj=io.BytesIO(p_cards.stdout))

    old_cards = {}
    mechanics = {}
    for m in tf_cards.getmembers():
        if m.name.startswith('content/cards/json/') and m.name.endswith('.json'):
            cid = m.name.replace('content/cards/json/', '').replace('.json', '')
            c = json.loads(tf_cards.extractfile(m).read().decode('utf-8'))
            c['_words'] = norm_words(c.get('description'))
            old_cards[cid] = c
        elif m.name.startswith('content/cards/mechanics/') and m.name.endswith('.json'):
            cid = m.name.replace('content/cards/mechanics/', '').replace('.json', '')
            mechanics[cid] = json.loads(tf_cards.extractfile(m).read().decode('utf-8'))

    p_heroes = subprocess.run(['git', 'archive', 'origin/v3', 'content/heroes/'], capture_output=True)
    tf_heroes = tarfile.open(fileobj=io.BytesIO(p_heroes.stdout))
    hero_mechanics = {}
    for m in tf_heroes.getmembers():
        if m.name.startswith('content/heroes/mechanics/') and m.name.endswith('.json'):
            stem = os.path.basename(m.name).replace('.json', '')
            hero_mechanics[stem] = json.loads(tf_heroes.extractfile(m).read().decode('utf-8'))

    print(f"Loaded from origin/v3: {len(old_cards)} cards, {len(mechanics)} mechanics, {len(hero_mechanics)} hero mechanics")

    # 3. Match Card Mechanics
    card_matches = {} # old_cid -> our_card
    assigned_card_ids = set()

    # Manual overrides
    for old_cid, our_id in SPECIAL_MANUAL_MAP.items():
        found = next((c for c in cards if c['id'] == our_id), None)
        if found:
            card_matches[old_cid] = found
            assigned_card_ids.add(found['id'])

    # Pass 1: exact names
    for cid in mechanics:
        if cid in card_matches: continue
        old = old_cards.get(cid)
        if not old: continue
        old_en = (old.get('name_en') or '').strip().lower()
        old_ru = (old.get('name') or '').strip().lower()
        
        for c in cards:
            if c['id'] in assigned_card_ids: continue
            c_en = (c.get('name_en') or '').strip().lower()
            c_ru = (c.get('name') or '').strip().lower()
            if (old_en and old_en == c_en) or (old_ru and old_ru == c_ru):
                card_matches[cid] = c
                assigned_card_ids.add(c['id'])
                break

    # Pass 2: stats and word overlap
    for cid in mechanics:
        if cid in card_matches: continue
        old = old_cards.get(cid)
        if not old: continue
        old_cat = old.get('typeCategory')
        old_land = LAND_MAP.get(old.get('landType'))
        old_cost = old.get('cost')
        old_atk = old.get('attack')
        old_def = old.get('defense')
        old_words = old['_words']

        best_cand = None
        best_score = -1

        for c in cards:
            if c['id'] in assigned_card_ids: continue
            if c.get('typeCategory') != old_cat: continue
            if c.get('cost') != old_cost: continue
            if old_cat == 'creature':
                if c.get('attack') != old_atk or c.get('defense') != old_def:
                    continue
            c_land = LAND_MAP.get(c.get('landType'))
            if old_land and c_land and old_land != c_land:
                continue

            overlap = len(old_words & c['_words'])
            if overlap > best_score:
                best_score = overlap
                best_cand = c

        if best_cand and (best_score >= 1 or (old_cat == 'creature' and not old_words)):
            card_matches[cid] = best_cand
            assigned_card_ids.add(best_cand['id'])

    # Pass 3: description similarity
    for cid in mechanics:
        if cid in card_matches: continue
        old = old_cards.get(cid)
        if not old: continue
        old_cat = old.get('typeCategory')
        old_land = LAND_MAP.get(old.get('landType'))
        old_cost = old.get('cost')
        old_desc = old.get('description') or ''

        best_cand = None
        best_ratio = 0.35

        for c in cards:
            if c['id'] in assigned_card_ids: continue
            if c.get('typeCategory') != old_cat: continue
            if c.get('cost') != old_cost: continue
            c_land = LAND_MAP.get(c.get('landType'))
            if old_land and c_land and old_land != c_land:
                continue

            c_desc = c.get('description') or ''
            ratio = SequenceMatcher(None, old_desc.lower(), c_desc.lower()).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_cand = c

        if best_cand:
            card_matches[cid] = best_cand
            assigned_card_ids.add(best_cand['id'])

    print(f"Cards matched with mechanics: {len(card_matches)} / {len(mechanics)}")

    # 4. Match Hero Mechanics using HERO_EXACT_MAP
    hero_by_id = {h['id']: h for h in heroes}
    hero_matches = {}

    for stem, h_mech in hero_mechanics.items():
        target_id = HERO_EXACT_MAP.get(stem)
        if target_id and target_id in hero_by_id:
            hero_matches[stem] = (hero_by_id[target_id], h_mech)
        else:
            print(f"WARNING: Hero mechanics not matched: {stem} -> {target_id}")

    print(f"Heroes matched with mechanics: {len(hero_matches)} / {len(hero_mechanics)}")

    # 5. Embed abilities into card JSON files
    for c in cards:
        c["abilities"] = []
        c.pop("flavorOnly", None)

    integrated_card_count = 0
    for old_cid, our_card in card_matches.items():
        m = mechanics[old_cid]
        our_card["abilities"] = m.get("abilities", [])
        if m.get("flavorOnly"):
            our_card["flavorOnly"] = True
        integrated_card_count += 1

    # 6. Embed ability into hero JSON files
    for h in heroes:
        h["ability"] = None
        h.pop("wordSetup", None)

    integrated_hero_count = 0
    for stem, (our_hero, h_mech) in hero_matches.items():
        our_hero["ability"] = h_mech.get("ability")
        if h_mech.get("wordSetup"):
            our_hero["wordSetup"] = h_mech.get("wordSetup")
        integrated_hero_count += 1

    # 7. Write all updated JSON files back to disk
    print("\nWriting updated JSON files to content/...")
    for item in all_items:
        p = item.pop('_path')
        item.pop('_words', None)
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(item, f, ensure_ascii=False, indent=2)

    # 8. Re-generate content/index.json and index.min.json
    print("Regenerating global catalogs content/index.json & index.min.json...")
    index_path = os.path.join(CONTENT_DIR, "index.json")
    with open(index_path, 'w', encoding='utf-8') as f:
        json.dump(all_items, f, ensure_ascii=False, indent=2)

    min_index_path = os.path.join(CONTENT_DIR, "index.min.json")
    with open(min_index_path, 'w', encoding='utf-8') as f:
        json.dump(all_items, f, ensure_ascii=False, separators=(',', ':'))

    print("\n" + "=" * 60)
    print(" INTEGRATION COMPLETE!")
    print("=" * 60)
    print(f"Cards with integrated abilities: {integrated_card_count}")
    print(f"Heroes with integrated abilities:{integrated_hero_count}")
    print(f"Total items in index.json:       {len(all_items)}")
    print("=" * 60)

if __name__ == '__main__':
    main()
