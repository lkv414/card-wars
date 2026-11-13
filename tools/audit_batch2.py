#!/usr/bin/env python3
"""Audit script for cards batch 2 (ледяные, песчаные, радужные, синие равнины, хеллоуинские)"""
import os
import json
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, "исходники", "Images", "карты")
DIRS = ["ледяные", "песчаные", "радужные", "синие равнины", "хеллоуинские"]

CONTENT_CARDS = os.path.join(ROOT, "content-new", "cards", "json")
SRC_CARDS = os.path.join(ROOT, "исходники", "карты")

# Load existing cards by normalized name
catalog = {}
if os.path.exists(CONTENT_CARDS):
    for f in os.listdir(CONTENT_CARDS):
        if f.endswith(".json"):
            with open(os.path.join(CONTENT_CARDS, f), encoding="utf-8") as fp:
                c = json.load(fp)
                name = c.get("name", "").strip().lower()
                if name:
                    catalog[name] = c

total_cards = 0
homoglyph_issues = []
spacing_issues = []
diff_issues = []

for d in DIRS:
    dp = os.path.join(BASE, d)
    for f in os.listdir(dp):
        if not f.endswith(".json"):
            continue
        total_cards += 1
        jp = os.path.join(dp, f)
        with open(jp, "r", encoding="utf-8") as fp:
            data = json.load(fp)

        # 1. Homoglyphs
        for field in ["name", "description", "type", "land_type"]:
            val = data.get(field, "") or ""
            words = re.findall(r"\b[\w\-]+\b", val)
            for w in words:
                has_cyr = any("\u0400" <= ch <= "\u04FF" for ch in w)
                has_lat = any("a" <= ch.lower() <= "z" for ch in w)
                if has_cyr and has_lat:
                    # ignore common acronyms if any
                    homoglyph_issues.append((jp, field, w, val))

        # 2. Spacing issues (double spaces, trailing spaces)
        for field in ["name", "description", "type", "flavor"]:
            val = data.get(field, "") or ""
            if "  " in val:
                spacing_issues.append((jp, field, "double spaces", val))
            if val.strip() != val and "\n" not in val:
                spacing_issues.append((jp, field, "leading/trailing spaces", repr(val)))

        # 3. Cross-catalog comparison
        name_key = data.get("name", "").strip().lower()
        if name_key in catalog:
            cat_card = catalog[name_key]
            # Check description diff
            d1 = re.sub(r"\s+", " ", data.get("description", "").strip())
            d2 = re.sub(r"\s+", " ", cat_card.get("description", "").strip())
            if d1 != d2:
                diff_issues.append({
                    "card": data.get("name"),
                    "file": jp,
                    "field": "description",
                    "images_desc": data.get("description"),
                    "catalog_desc": cat_card.get("description")
                })
            # Check cost diff
            if data.get("cost") != cat_card.get("cost"):
                diff_issues.append({
                    "card": data.get("name"),
                    "file": jp,
                    "field": "cost",
                    "images_val": data.get("cost"),
                    "catalog_val": cat_card.get("cost")
                })
            # Check atk/def diff
            if data.get("attack") != cat_card.get("attack"):
                diff_issues.append({
                    "card": data.get("name"),
                    "file": jp,
                    "field": "attack",
                    "images_val": data.get("attack"),
                    "catalog_val": cat_card.get("attack")
                })
            if data.get("defense") != cat_card.get("defense"):
                diff_issues.append({
                    "card": data.get("name"),
                    "file": jp,
                    "field": "defense",
                    "images_val": data.get("defense"),
                    "catalog_val": cat_card.get("defense")
                })

print(f"Total cards audited in Batch 2: {total_cards}")
print(f"Homoglyph issues found: {len(homoglyph_issues)}")
for h in homoglyph_issues:
    print(f"  [Homoglyph] {os.path.basename(h[0])} {h[1]}: '{h[2]}' in '{h[3]}'")

print(f"Spacing issues found: {len(spacing_issues)}")
for s in spacing_issues[:10]:
    print(f"  [Spacing] {os.path.basename(s[0])} {s[1]}: {s[2]} in {s[3]}")

print(f"Cross-catalog diffs found: {len(diff_issues)}")
for diff in diff_issues[:15]:
    print(f"  [Diff] {diff['card']} ({diff['field']}):\n    Images : {diff.get('images_desc') or diff.get('images_val')}\n    Catalog: {diff.get('catalog_desc') or diff.get('catalog_val')}")
