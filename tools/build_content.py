#!/usr/bin/env python3
"""
Build script for content/ directory.
Converts all 972 cards from исходники/Images/ into content/ with:
- Full-size WebP images (quality=85)
- Matching JSON files right next to each WebP image
- Clean folder structure by card type and land type
- Global content/index.json catalog for fast web consumption
"""

import os
import sys
import glob
import json
import shutil
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from PIL import Image

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT_DIR, "исходники", "Images")
DEST_DIR = os.path.join(ROOT_DIR, "content")

FOLDER_MAPPING = {
    os.path.join("герои"): ("heroes", "hero"),
    os.path.join("земли"): ("lands", "land"),
    os.path.join("прочее"): ("other", "other"),
    os.path.join("карты", "болотные"): (os.path.join("cards", "swamp"), "card"),
    os.path.join("карты", "добрые"): (os.path.join("cards", "nice"), "card"),
    os.path.join("карты", "кукурузные"): (os.path.join("cards", "corn"), "card"),
    os.path.join("карты", "лавовые"): (os.path.join("cards", "lava"), "card"),
    os.path.join("карты", "ледяные"): (os.path.join("cards", "icy"), "card"),
    os.path.join("карты", "песчаные"): (os.path.join("cards", "sandy"), "card"),
    os.path.join("карты", "радужные"): (os.path.join("cards", "rainbow"), "card"),
    os.path.join("карты", "синие равнины"): (os.path.join("cards", "blue-plains"), "card"),
    os.path.join("карты", "хеллоуинские"): (os.path.join("cards", "halloween"), "card"),
}

def convert_single_card(item):
    src_img = item["src_img"]
    dest_img = item["dest_img"]
    dest_json = item["dest_json"]
    card_data = item["card_data"]

    # 1. Convert Image to WebP
    try:
        im = Image.open(src_img)
        # Convert to RGB if RGBA without transparency or CMYK
        if im.mode in ('RGBA', 'LA') and im.getchannel('A').getextrema() == (255, 255):
            im = im.convert('RGB')
        elif im.mode not in ('RGB', 'RGBA'):
            im = im.convert('RGB')
        
        im.save(dest_img, 'WEBP', quality=85, method=6)
    except Exception as e:
        return False, f"Image error {src_img}: {e}"

    # 2. Write JSON
    try:
        with open(dest_json, 'w', encoding='utf-8') as f:
            json.dump(card_data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        return False, f"JSON error {dest_json}: {e}"

    return True, item["id"]

def main():
    t0 = time.time()
    print("=" * 60)
    print(" BUILDING CONTENT/ REPOSITORY")
    print("=" * 60)

    # 1. Clean existing content directory
    if os.path.exists(DEST_DIR):
        print(f"Cleaning existing {DEST_DIR}...")
        shutil.rmtree(DEST_DIR)
    os.makedirs(DEST_DIR, exist_ok=True)

    # 2. Collect all cards from исходники/Images
    tasks = []
    index_entries = []

    for src_rel, (dest_rel, kind) in FOLDER_MAPPING.items():
        src_folder = os.path.join(SRC_DIR, src_rel)
        dest_folder = os.path.join(DEST_DIR, dest_rel)
        os.makedirs(dest_folder, exist_ok=True)

        json_paths = sorted(glob.glob(os.path.join(src_folder, "*.json")))
        print(f"Folder '{src_rel}' -> '{dest_rel}': {len(json_paths)} cards")

        for jpath in json_paths:
            stem, _ = os.path.splitext(os.path.basename(jpath))
            
            # Find image
            img_path = None
            for ext in ('.png', '.jpg', '.jpeg'):
                candidate = os.path.join(src_folder, stem + ext)
                if os.path.exists(candidate):
                    img_path = candidate
                    break
            
            if not img_path:
                print(f"ERROR: missing image for {jpath}")
                sys.exit(1)

            with open(jpath, 'r', encoding='utf-8') as f:
                data = json.load(f)

            card_id = data.get("id") or stem
            web_img_rel = "/" + os.path.join("content", dest_rel, f"{card_id}.webp").replace("\\", "/")

            # Prepare card JSON
            card_obj = dict(data)
            card_obj["id"] = card_id
            card_obj["kind"] = kind
            card_obj["image"] = web_img_rel

            dest_img = os.path.join(dest_folder, f"{card_id}.webp")
            dest_json = os.path.join(dest_folder, f"{card_id}.json")

            tasks.append({
                "id": card_id,
                "src_img": img_path,
                "dest_img": dest_img,
                "dest_json": dest_json,
                "card_data": card_obj
            })

            index_entries.append(card_obj)

    print(f"\nTotal items to process: {len(tasks)}")
    assert len(tasks) == 972, f"Expected 972 items, got {len(tasks)}"

    # 3. Parallel Conversion
    print(f"Converting {len(tasks)} images to WebP and writing JSONs (parallel)...")
    success_count = 0
    max_workers = os.cpu_count() or 4
    
    with ProcessPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(convert_single_card, t): t for t in tasks}
        for future in as_completed(futures):
            ok, msg = future.result()
            if not ok:
                print("FAILURE:", msg)
                sys.exit(1)
            success_count += 1
            if success_count % 100 == 0 or success_count == len(tasks):
                print(f"  Processed {success_count}/{len(tasks)} items...")

    # 4. Write content/index.json
    index_path = os.path.join(DEST_DIR, "index.json")
    print(f"\nWriting global catalog to {index_path}...")
    with open(index_path, 'w', encoding='utf-8') as f:
        json.dump(index_entries, f, ensure_ascii=False, indent=2)

    # Also write minified version for production
    min_index_path = os.path.join(DEST_DIR, "index.min.json")
    with open(min_index_path, 'w', encoding='utf-8') as f:
        json.dump(index_entries, f, ensure_ascii=False, separators=(',', ':'))

    # 5. Summary statistics
    t1 = time.time()
    total_webp_size = sum(os.path.getsize(t["dest_img"]) for t in tasks)
    raw_index_size = os.path.getsize(index_path)
    min_index_size = os.path.getsize(min_index_path)

    print("\n" + "=" * 60)
    print(" BUILD COMPLETE!")
    print("=" * 60)
    print(f"Cards processed:       {len(tasks)} / 972 (100%)")
    print(f"Time taken:            {t1 - t0:.2f} seconds")
    print(f"Total WebP images size:{total_webp_size / (1024*1024):.2f} MB (vs ~2150 MB original PNGs!)")
    print(f"Average WebP size:     {total_webp_size / len(tasks) / 1024:.1f} KB per card")
    print(f"index.json size:       {raw_index_size / 1024:.1f} KB")
    print(f"index.min.json size:   {min_index_size / 1024:.1f} KB (~95 KB gzip)")
    print("=" * 60)

if __name__ == '__main__':
    main()
