#!/usr/bin/env python3
"""
Extended Comparison and Text Quality Audit for Batch 1:
- болотные (114)
- добрые (93)
- кукурузные (105)
- лавовые (59)
"""

import os
import sys
import json
import re
from typing import Dict, List, Tuple, Any

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, "исходники", "Images", "карты")
DIRS = ["болотные", "добрые", "кукурузные", "лавовые"]
CONTENT_NEW = os.path.join(ROOT, "content-new", "cards", "json")
CARDS_JSON = os.path.join(ROOT, "исходники", "cards.json")
CARDS_REOCR = os.path.join(ROOT, "исходники", "cards_reocr")

def normalize_name(s: str) -> str:
    if not s:
        return ""
    s = s.lower().replace("ё", "е")
    s = re.sub(r"[^a-zа-я0-9]", "", s)
    return s

def load_catalogs():
    # 1. content-new
    content_map = {}
    if os.path.exists(CONTENT_NEW):
        for f in os.listdir(CONTENT_NEW):
            if f.endswith(".json"):
                with open(os.path.join(CONTENT_NEW, f), encoding="utf-8") as fp:
                    d = json.load(fp)
                    content_map[normalize_name(d.get("name"))] = d

    # 2. cards.json
    cards_map = {}
    if os.path.exists(CARDS_JSON):
        with open(CARDS_JSON, encoding="utf-8") as fp:
            d = json.load(fp)
            if isinstance(d, dict):
                for k, v in d.items():
                    cards_map[normalize_name(v.get("name"))] = v

    # 3. cards_reocr
    reocr_map = {}
    if os.path.exists(CARDS_REOCR):
        for f in os.listdir(CARDS_REOCR):
            if f.endswith(".json"):
                with open(os.path.join(CARDS_REOCR, f), encoding="utf-8") as fp:
                    d = json.load(fp)
                    name = d.get("name_ru") or d.get("name")
                    reocr_map[normalize_name(name)] = d

    return content_map, cards_map, reocr_map

def run_comparison():
    content_map, cards_map, reocr_map = load_catalogs()

    total = 0
    matched_catalog = 0
    unique_new_cards = []
    stat_diffs = []
    desc_diffs = []
    keyword_audit = []

    for d in DIRS:
        dir_path = os.path.join(BASE, d)
        for fname in sorted(os.listdir(dir_path)):
            if not fname.endswith(".json"):
                continue
            total += 1
            jpath = os.path.join(dir_path, fname)
            with open(jpath, encoding="utf-8") as fp:
                card = json.load(fp)

            name = card.get("name", "")
            norm = normalize_name(name)

            # Match against catalog
            ref = content_map.get(norm) or cards_map.get(norm) or reocr_map.get(norm)

            if not ref:
                unique_new_cards.append((d, name, card.get("type"), card.get("cost")))
            else:
                matched_catalog += 1
                # Check stats
                ref_cost = ref.get("cost")
                ref_atk = ref.get("attack")
                ref_def = ref.get("defense") or ref.get("health")

                c_cost = card.get("cost")
                c_atk = card.get("attack")
                c_def = card.get("defense")

                if (ref_cost is not None and c_cost is not None and ref_cost != c_cost) or \
                   (ref_atk is not None and c_atk is not None and ref_atk != c_atk) or \
                   (ref_def is not None and c_def is not None and ref_def != c_def):
                    stat_diffs.append({
                        "name": name,
                        "folder": d,
                        "scan_stats": (c_cost, c_atk, c_def),
                        "ref_stats": (ref_cost, ref_atk, ref_def),
                    })

            # Keyword audit
            desc = card.get("description", "")
            # check lowercase "флюп:" or "прием:"
            if re.search(r"\bфлюп[:\s]", desc, re.IGNORECASE) and not ("ФЛЮП" in desc or "Флюп" in desc):
                keyword_audit.append((d, name, "Uncapitalized 'флюп'"))
            if re.search(r"\bприем[:\s]", desc, re.IGNORECASE) and not ("ПРИЕМ" in desc or "Прием" in desc or "ПРИЁМ" in desc or "Приём" in desc):
                keyword_audit.append((d, name, "Uncapitalized 'прием'"))

    print(f"=== BATCH 1 AUDIT REPORT ({total} cards) ===")
    print(f"Matched in existing catalogs: {matched_catalog} ({matched_catalog/total*100:.1f}%)")
    print(f"Unique new cards (only in high-res scans): {len(unique_new_cards)} ({len(unique_new_cards)/total*100:.1f}%)")
    print(f"Stat differences against catalog: {len(stat_diffs)}")
    print(f"Keyword formatting issues: {len(keyword_audit)}")

    if stat_diffs:
        print("\nStat differences:")
        for s in stat_diffs:
            print(f"  {s['folder']}/{s['name']}: scan={s['scan_stats']} vs ref={s['ref_stats']}")

    print("\nUnique cards breakdown by folder:")
    by_folder = {}
    for folder, cname, ctype, cost in unique_new_cards:
        by_folder.setdefault(folder, []).append((cname, ctype, cost))
    for fld, clist in by_folder.items():
        print(f"  {fld}: {len(clist)} unique cards")
        for cn, ct, cc in clist[:5]:
            print(f"    - {cn} ({ct}, cost: {cc})")

if __name__ == "__main__":
    run_comparison()
