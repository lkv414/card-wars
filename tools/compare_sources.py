#!/usr/bin/env python3
"""
Cross-Scan Comparison Tool:
Compares all 972 scans in исходники/Images with content-new/ and исходники/cards.json.

Identifies:
1. Exact matches (stats and description match).
2. Text/stat diffs on identical card names (wording differences, stat discrepancies).
3. Unique cards present only in Images (e.g., Halloween, Lava, Kickstarter sets).

Generates markdown report and prints summary table.
"""

import os
import sys
import json
import re
import argparse
from typing import Dict, List, Tuple, Any, Optional

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES_DIR = os.path.join(ROOT_DIR, "исходники", "Images")
CONTENT_NEW_DIR = os.path.join(ROOT_DIR, "content-new")
CARDS_JSON_PATH = os.path.join(ROOT_DIR, "исходники", "cards.json")
DEFAULT_REPORT_PATH = os.path.join(ROOT_DIR, "reports", "source_comparison_report.md")


def norm(text: Optional[str]) -> str:
    if not text:
        return ""
    t = str(text).lower().replace("ё", "е").replace("\n", " ").replace("—", "-").replace("–", "-")
    # standardize quotation marks and special arrows
    t = t.replace("«", "").replace("»", "").replace('"', "").replace("'", "")
    t = t.replace(">>>", " ").replace(">>", " ")
    t = re.sub(r"[^0-9a-zа-я]+", " ", t)
    return " ".join(t.split())


def norm_desc(text: Optional[str]) -> str:
    """Normalize description for comparing substance rather than minor typography."""
    if not text:
        return ""
    t = norm(text)
    # Common terminology equivalences in Russian Card Wars:
    t = t.replace("атк", "атаке").replace("atk", "атаке").replace("к атаке", "атаке")
    t = t.replace("защ", "защите").replace("def", "защите").replace("к защите", "защите")
    t = t.replace("hp", "жизней").replace("хп", "жизней").replace("жизнь", "жизней")
    t = t.replace("тяни карту", "возьми карту").replace("тянет карту", "берет карту")
    return " ".join(t.split())


class SourceCatalog:
    def __init__(self):
        # By normalized Russian name and English name
        self.cards_by_name: Dict[str, List[Dict[str, Any]]] = {}
        self.cards_by_en: Dict[str, List[Dict[str, Any]]] = {}
        self.heroes_by_name: Dict[str, List[Dict[str, Any]]] = {}
        self.lands_by_name: Dict[str, List[Dict[str, Any]]] = {}
        self.other_by_name: Dict[str, List[Dict[str, Any]]] = {}

    def load(self):
        # 1. content-new cards
        cards_dir = os.path.join(CONTENT_NEW_DIR, "cards", "json")
        if os.path.exists(cards_dir):
            for fname in os.listdir(cards_dir):
                if fname.endswith(".json"):
                    try:
                        p = os.path.join(cards_dir, fname)
                        data = json.load(open(p, encoding="utf-8"))
                        data["_source"] = f"content-new/cards/{fname}"
                        self._add_entry(self.cards_by_name, self.cards_by_en, data)
                    except Exception:
                        pass

        # 2. content-new heroes
        heroes_dir = os.path.join(CONTENT_NEW_DIR, "heroes", "json")
        if os.path.exists(heroes_dir):
            for fname in os.listdir(heroes_dir):
                if fname.endswith(".json"):
                    try:
                        p = os.path.join(heroes_dir, fname)
                        data = json.load(open(p, encoding="utf-8"))
                        data["_source"] = f"content-new/heroes/{fname}"
                        self._add_entry(self.heroes_by_name, None, data)
                    except Exception:
                        pass

        # 3. content-new lands
        lands_dir = os.path.join(CONTENT_NEW_DIR, "lands", "json")
        if os.path.exists(lands_dir):
            for fname in os.listdir(lands_dir):
                if fname.endswith(".json"):
                    try:
                        p = os.path.join(lands_dir, fname)
                        data = json.load(open(p, encoding="utf-8"))
                        data["_source"] = f"content-new/lands/{fname}"
                        self._add_entry(self.lands_by_name, None, data)
                    except Exception:
                        pass

        # 4. cards.json
        if os.path.exists(CARDS_JSON_PATH):
            try:
                raw = json.load(open(CARDS_JSON_PATH, encoding="utf-8"))
                for k, v in raw.items():
                    if isinstance(v, dict):
                        entry = {
                            "name": v.get("name"),
                            "cost": v.get("cost"),
                            "attack": v.get("attack"),
                            "defense": v.get("health"),
                            "type": v.get("card_type"),
                            "land_type": v.get("land_type"),
                            "description": v.get("description"),
                            "_source": f"cards.json/{k}",
                        }
                        self._add_entry(self.cards_by_name, None, entry)
            except Exception:
                pass

    def _add_entry(self, by_name_dict, by_en_dict, data):
        name = data.get("name")
        if name:
            n = norm(name)
            if n:
                by_name_dict.setdefault(n, []).append(data)
        if by_en_dict is not None:
            en = data.get("name_en")
            if en:
                ne = norm(en)
                if ne:
                    by_en_dict.setdefault(ne, []).append(data)

    def find_match(self, category: str, name: str, name_en: Optional[str]) -> Optional[Dict[str, Any]]:
        n = norm(name)
        ne = norm(name_en) if name_en else ""

        target_dict = self.cards_by_name
        target_en = self.cards_by_en
        if category == "герои":
            target_dict = self.heroes_by_name
            target_en = None
        elif category == "земли":
            target_dict = self.lands_by_name
            target_en = None
        elif category == "прочее":
            target_dict = self.other_by_name
            target_en = None

        # 1. Exact match in target category by Russian name
        if n in target_dict:
            return target_dict[n][0]

        # 2. Match by English name if available
        if target_en and ne and ne in target_en:
            return target_en[ne][0]

        # 3. Cross-category fallback in cards
        if category not in ("герои", "земли", "прочее"):
            if n in self.cards_by_name:
                return self.cards_by_name[n][0]
            if ne and ne in self.cards_by_en:
                return self.cards_by_en[ne][0]
        else:
            # Maybe hero is in cards_by_name
            if n in self.cards_by_name:
                return self.cards_by_name[n][0]

        return None


def get_image_relative_folder(full_path: str) -> str:
    rel = os.path.relpath(full_path, IMAGES_DIR)
    parts = os.path.normpath(rel).split(os.sep)
    if len(parts) >= 2 and parts[0] == "карты":
        return f"карты/{parts[1]}"
    elif parts:
        return parts[0]
    return "unknown"


def compare_card(img_data: Dict[str, Any], cat_data: Dict[str, Any]) -> Tuple[bool, List[str], Dict[str, Any]]:
    """
    Returns (is_exact, diff_reasons, diff_details)
    """
    diff_reasons = []
    diff_details = {}

    # Cost
    c1 = img_data.get("cost")
    c2 = cat_data.get("cost")
    if c1 != c2:
        diff_reasons.append("cost")
        diff_details["cost"] = {"images": c1, "catalog": c2}

    # Attack
    a1 = img_data.get("attack")
    a2 = cat_data.get("attack")
    if a1 != a2:
        diff_reasons.append("attack")
        diff_details["attack"] = {"images": a1, "catalog": a2}

    # Defense / Health
    d1 = img_data.get("defense")
    d2 = cat_data.get("defense") if "defense" in cat_data else cat_data.get("health")
    if d1 != d2:
        diff_reasons.append("defense")
        diff_details["defense"] = {"images": d1, "catalog": d2}

    # Description
    desc1 = img_data.get("description", "")
    desc2 = cat_data.get("description", "")
    if norm_desc(desc1) != norm_desc(desc2):
        diff_reasons.append("description")
        diff_details["description"] = {
            "images": desc1,
            "catalog": desc2,
        }

    is_exact = len(diff_reasons) == 0
    return is_exact, diff_reasons, diff_details


def run_comparison() -> Dict[str, Any]:
    catalog = SourceCatalog()
    catalog.load()

    results = {
        "total_scans": 0,
        "exact_matches": 0,
        "diff_matches": 0,
        "unique_images": 0,
        "by_folder": {},
        "diff_details_list": [],
        "unique_cards_list": [],
        "stat_diffs_list": [],
    }

    folder_order = [
        "герои",
        "земли",
        "прочее",
        "карты/болотные",
        "карты/добрые",
        "карты/кукурузные",
        "карты/лавовые",
        "карты/ледяные",
        "карты/песчаные",
        "карты/радужные",
        "карты/синие равнины",
        "карты/хеллоуинские",
    ]

    for f in folder_order:
        results["by_folder"][f] = {
            "total": 0,
            "exact": 0,
            "diffs": 0,
            "unique": 0,
        }

    # Scan all images
    for root, _, files in os.walk(IMAGES_DIR):
        for f in sorted(files):
            if f.lower().endswith(".json"):
                jpath = os.path.join(root, f)
                try:
                    img_data = json.load(open(jpath, encoding="utf-8"))
                except Exception:
                    continue

                folder = get_image_relative_folder(jpath)
                if folder not in results["by_folder"]:
                    results["by_folder"][folder] = {"total": 0, "exact": 0, "diffs": 0, "unique": 0}

                results["total_scans"] += 1
                folder_stats = results["by_folder"][folder]
                folder_stats["total"] += 1

                card_name = img_data.get("name", "")
                card_name_en = img_data.get("name_en", "")

                matched_cat = catalog.find_match(folder, card_name, card_name_en)

                if matched_cat:
                    is_exact, reasons, details = compare_card(img_data, matched_cat)
                    if is_exact:
                        results["exact_matches"] += 1
                        folder_stats["exact"] += 1
                    else:
                        results["diff_matches"] += 1
                        folder_stats["diffs"] += 1
                        diff_entry = {
                            "name": card_name,
                            "folder": folder,
                            "file": f,
                            "catalog_source": matched_cat.get("_source", ""),
                            "reasons": reasons,
                            "details": details,
                        }
                        results["diff_details_list"].append(diff_entry)
                        if any(r in ("cost", "attack", "defense") for r in reasons):
                            results["stat_diffs_list"].append(diff_entry)
                else:
                    results["unique_images"] += 1
                    folder_stats["unique"] += 1
                    results["unique_cards_list"].append({
                        "name": card_name,
                        "name_en": card_name_en,
                        "folder": folder,
                        "type": img_data.get("type", ""),
                        "cost": img_data.get("cost"),
                        "attack": img_data.get("attack"),
                        "defense": img_data.get("defense"),
                        "file": f,
                    })

    return results


def print_summary_table(results: Dict[str, Any]):
    print("=" * 78)
    print(" CROSS-SCAN COMPARISON: исходники/Images vs Catalog (content-new, cards.json)")
    print("=" * 78)
    header = f"{'Folder / Category':<24} | {'Total':>5} | {'Exact':>5} | {'Diffs':>5} | {'Unique (New)':>12}"
    print(header)
    print("-" * 78)

    for folder, stats in results["by_folder"].items():
        row = f"{folder:<24} | {stats['total']:>5} | {stats['exact']:>5} | {stats['diffs']:>5} | {stats['unique']:>12}"
        print(row)

    print("-" * 78)
    total_row = (
        f"{'TOTAL':<24} | {results['total_scans']:>5} | "
        f"{results['exact_matches']:>5} | {results['diff_matches']:>5} | "
        f"{results['unique_images']:>12}"
    )
    print(total_row)
    print("=" * 78)
    print(f"Summary:")
    print(f"  * Total High-Res Scans:        {results['total_scans']}")
    print(f"  * Exact Matches:               {results['exact_matches']} ({results['exact_matches']/results['total_scans']*100:.1f}%)")
    print(f"  * Text/Stat Diffs (Same Name): {results['diff_matches']} ({results['diff_matches']/results['total_scans']*100:.1f}%)")
    print(f"    - Of which Stat Diffs:       {len(results['stat_diffs_list'])}")
    print(f"    - Of which Text Diffs:       {results['diff_matches'] - len(results['stat_diffs_list'])}")
    print(f"  * Unique Cards Only in Images: {results['unique_images']} ({results['unique_images']/results['total_scans']*100:.1f}%)")
    print("=" * 78)


def generate_markdown_report(results: Dict[str, Any], output_path: str):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("# Отчет о сравнении исходных сканов (исходники/Images) с каталогом\n\n")
        f.write("Сравнение выполнено между **972 новыми сканами** в `исходники/Images` и существующими каталогами `content-new/` и `исходники/cards.json`.\n\n")

        # Table
        f.write("## 1. Сводная таблица по категориям\n\n")
        f.write("| Категория / Папка | Всего сканов | Точные совпадения | Отличия в тексте/статах | Уникальные (только в Images) |\n")
        f.write("|:---|:---:|:---:|:---:|:---:|\n")
        for folder, stats in results["by_folder"].items():
            f.write(f"| `{folder}` | {stats['total']} | {stats['exact']} | {stats['diffs']} | **{stats['unique']}** |\n")
        f.write(f"| **ИТОГО** | **{results['total_scans']}** | **{results['exact_matches']}** | **{results['diff_matches']}** | **{results['unique_images']}** |\n\n")

        # Stat Diffs
        f.write("## 2. Карты с расхождениями в числовых характеристиках (Статы)\n\n")
        if results["stat_diffs_list"]:
            f.write("| Карта | Папка | Сканы (Images) | Каталог (content-new / cards.json) | Источник каталога |\n")
            f.write("|:---|:---|:---|:---|:---|\n")
            for item in results["stat_diffs_list"]:
                name = item["name"]
                folder = item["folder"]
                src = item["catalog_source"]
                img_stats = []
                cat_stats = []
                for s in ("cost", "attack", "defense"):
                    if s in item["details"]:
                        img_stats.append(f"{s}: {item['details'][s]['images']}")
                        cat_stats.append(f"{s}: {item['details'][s]['catalog']}")
                f.write(f"| **{name}** | `{folder}` | {', '.join(img_stats)} | {', '.join(cat_stats)} | `{src}` |\n")
            f.write("\n")
        else:
            f.write("Числовых расхождений в статах не обнаружено.\n\n")

        # Text Diffs sample
        f.write("## 3. Карты с текстовыми отличиями (формулировки, пунктуация, терминология)\n\n")
        f.write("Большинство текстовых расхождений обусловлено разницей между официальной печатной терминологией физического издания («к атаке», «возьми карту», развернутые правила) и сокращениями в оцифровке («АТК», «тяни карту»).\n\n")
        f.write("| Карта | Папка | Текст на скане (Images) | Текст в каталоге |\n")
        f.write("|:---|:---|:---|:---|\n")
        for item in results["diff_details_list"][:25]:
            if "description" in item["details"]:
                d_img = item["details"]["description"]["images"].replace("\n", " ")
                d_cat = item["details"]["description"]["catalog"].replace("\n", " ")
                f.write(f"| **{item['name']}** | `{item['folder']}` | {d_img[:90]}... | {d_cat[:90]}... |\n")
        if len(results["diff_details_list"]) > 25:
            f.write(f"\n*(И еще {len(results['diff_details_list']) - 25} карт с текстовыми вариациями)*\n\n")

        # Unique cards breakdown
        f.write("## 4. Уникальные карты, присутствующие ТОЛЬКО в `исходники/Images`\n\n")
        f.write(f"Всего выявлено **{results['unique_images']}** уникальных карт и сущностей, отсутствовавших в базовом каталоге `content-new`. Это карты из дополнений (Лавовые земли, Хеллоуинские наборы, Кикстартер-герои, промо-карты, Doubles Tournament и For the Glory!).\n\n")

        # Group unique by folder
        unique_by_folder = {}
        for u in results["unique_cards_list"]:
            unique_by_folder.setdefault(u["folder"], []).append(u)

        for folder, ulist in unique_by_folder.items():
            f.write(f"### {folder} ({len(ulist)} карт)\n\n")
            f.write("| Название | English | Тип | Стоимость | Атака / Защита |\n")
            f.write("|:---|:---|:---|:---:|:---:|\n")
            for u in ulist[:20]:
                cost = u['cost'] if u['cost'] is not None else '-'
                atk = u['attack'] if u['attack'] is not None else '-'
                defense = u['defense'] if u['defense'] is not None else '-'
                f.write(f"| **{u['name']}** | {u['name_en'] or '-'} | {u['type']} | {cost} | {atk} / {defense} |\n")
            if len(ulist) > 20:
                f.write(f"| ... | *(еще {len(ulist)-20} карт)* | | | |\n")
            f.write("\n")

    print(f"Markdown report generated: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Cross-Scan Comparison Tool")
    parser.add_argument("--report", type=str, default=DEFAULT_REPORT_PATH, help="Path to markdown report")
    parser.add_argument("--json", action="store_true", help="Print structured results as JSON")
    parser.add_argument("--stat-diffs", action="store_true", help="Show all stat differences")
    args = parser.parse_args()

    results = run_comparison()

    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
        return

    print_summary_table(results)
    generate_markdown_report(results, args.report)

    if args.stat_diffs:
        print("\n=== Stat Differences Detailed Breakdown ===")
        for d in results["stat_diffs_list"]:
            print(f"- {d['name']} ({d['folder']}):")
            for s, vals in d["details"].items():
                if s != "description":
                    print(f"    {s}: images={vals['images']} vs catalog={vals['catalog']}")


if __name__ == "__main__":
    main()
