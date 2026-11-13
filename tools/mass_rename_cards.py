#!/usr/bin/env python3
"""
Mass-rename script for Card Wars OCR sources.
Renames images and corresponding JSON files to:
  {slug}-{short_hash}.png
  {slug}-{short_hash}.json

Preserves 100% data integrity, pairs, and JSON fields, while adding:
  "id": "{slug}-{short_hash}"
"""

import os
import sys
import glob
import json
import re

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES_DIR = os.path.join(ROOT_DIR, "исходники", "Images")

TRANSLIT_MAP = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
    'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
    'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
    'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
}

def to_slug(text: str) -> str:
    text = text.strip().lower()
    res = []
    for ch in text:
        if ch in TRANSLIT_MAP:
            res.append(TRANSLIT_MAP[ch])
        elif ch.isalnum() or ch in ('-', '_'):
            res.append(ch)
        elif ch in (' ', '\n', '\r', '\t', '/', '\\', '.', ',', ':', ';', '!', '?', '(', ')', '"', "'", '`', '«', '»'):
            res.append('-')
    slug = ''.join(res)
    slug = re.sub(r'-+', '-', slug).strip('-')
    return slug or 'card'

def main():
    print(f"Scanning images in: {IMAGES_DIR}")
    # Find all json files
    json_files = glob.glob(os.path.join(IMAGES_DIR, "**", "*.json"), recursive=True)
    print(f"Found {len(json_files)} JSON files.")

    rename_plan = []
    used_names = set()

    for jpath in json_files:
        dirpath = os.path.dirname(jpath)
        stem, _ = os.path.splitext(os.path.basename(jpath))

        # Find matching image
        img_path = None
        for ext in ('.png', '.jpg', '.jpeg'):
            candidate = os.path.join(dirpath, stem + ext)
            if os.path.exists(candidate):
                img_path = candidate
                img_ext = ext
                break
        
        if not img_path:
            print(f"WARNING: No matching image for JSON: {jpath}")
            continue

        with open(jpath, 'r', encoding='utf-8') as f:
            data = json.load(f)

        name_en = data.get('name_en') or ''
        name_ru = data.get('name') or ''
        sha = data.get('sha256') or ''
        if not sha:
            print(f"ERROR: missing sha256 in {jpath}")
            sys.exit(1)
        
        short_hash = sha[:7].lower()

        # Decide slug: prefer name_en if it contains latin letters
        if any(c.isascii() and c.isalpha() for c in name_en):
            slug = to_slug(name_en)
        else:
            slug = to_slug(name_ru)

        new_stem = f"{slug}-{short_hash}"

        # Ensure global uniqueness across the entire dataset
        target_stem = new_stem
        counter = 2
        while target_stem in used_names:
            target_stem = f"{new_stem}-{counter}"
            counter += 1
        
        used_names.add(target_stem)

        new_img_path = os.path.join(dirpath, target_stem + img_ext)
        new_jpath = os.path.join(dirpath, target_stem + ".json")

        rename_plan.append({
            "dir": dirpath,
            "old_stem": stem,
            "new_stem": target_stem,
            "old_img": img_path,
            "new_img": new_img_path,
            "old_json": jpath,
            "new_json": new_jpath,
            "data": data
        })

    print(f"Prepared rename plan for {len(rename_plan)} cards. Checking uniqueness...")
    assert len(used_names) == len(rename_plan), "Collision detected!"
    print("All stems are unique! Executing renames...")

    renamed_count = 0
    for item in rename_plan:
        old_img = item["old_img"]
        new_img = item["new_img"]
        old_json = item["old_json"]
        new_json = item["new_json"]
        data = item["data"]

        # Add id and preserve original steam stem
        data["id"] = item["new_stem"]
        if "steam_id" not in data and "httpssteamuser" in item["old_stem"]:
            data["steam_id"] = item["old_stem"]

        # 1. Rename image file
        if old_img != new_img:
            os.rename(old_img, new_img)

        # 2. Write new JSON file
        with open(new_json, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        # 3. Remove old JSON file if name changed
        if old_json != new_json and os.path.exists(old_json):
            os.remove(old_json)

        renamed_count += 1

    print(f"Successfully renamed {renamed_count} cards and JSON files!")

if __name__ == '__main__':
    main()
