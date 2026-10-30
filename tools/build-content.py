#!/usr/bin/env python3
"""Build a deduplicated content catalog from the corrected scan JSONs."""
import argparse
import hashlib
import json
import os
import re
import shutil
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "исходники", "карты")
OLD = os.path.join(ROOT, "content")
OUT = os.path.join(ROOT, "content-new")
REPORT = os.path.join(ROOT, ".tmp-reocr", "content_build_report.md")

LAT2CYR = str.maketrans(
    {
        "a": "а",
        "b": "в",
        "c": "с",
        "e": "е",
        "h": "н",
        "k": "к",
        "m": "м",
        "o": "о",
        "p": "р",
        "t": "т",
        "x": "х",
        "y": "у",
    }
)


def read_json(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))


def norm_name(value):
    text = (value or "").lower().replace("ё", "е").translate(LAT2CYR)
    text = re.sub(r"[^0-9a-zа-я]+", " ", text)
    return " ".join(text.split())


def norm_desc(value):
    text = (value or "").lower().replace("ё", "е")
    text = text.replace("atk", "атк").replace("def", "защ")
    text = re.sub(r"[^0-9a-zа-я]+", " ", text)
    return " ".join(text.split())


def sim(a, b):
    import difflib

    return difflib.SequenceMatcher(None, norm_desc(a), norm_desc(b)).ratio()


def natural(key):
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", key)]


def majority(values, fallback):
    counts = Counter(value for value in values if value is not None)
    if not counts:
        return fallback
    best = max(counts.values())
    return min((value for value, count in counts.items() if count == best), key=str)


def canonical_name(scans):
    counts = Counter(scan["name"] for scan in scans)
    best = max(counts.values())
    candidates = [name for name, count in counts.items() if count == best]
    return sorted(candidates, key=lambda name: ("a" <= name.lower() <= "z", name))[0]


def medoid_description(scans):
    if len(scans) == 1:
        return scans[0]["description"] or ""
    best = scans[0]
    best_score = -1.0
    for scan in scans:
        score = sum(sim(scan["description"], other["description"]) for other in scans) / len(scans)
        if score > best_score:
            best_score = score
            best = scan
    return best["description"] or ""


def load_scans():
    scans = []
    for filename in sorted(os.listdir(SRC), key=natural):
        if not filename.endswith(".json"):
            continue
        data = read_json(os.path.join(SRC, filename))
        stem = filename[:-5]
        scans.append(
            {
                "file": filename,
                "stem": stem,
                "pack": stem.split("_card_")[0] if "_card_" in stem else "other",
                "name": data.get("name", ""),
                "type": data.get("type", ""),
                "typeCategory": data.get("typeCategory", ""),
                "landType": data.get("landType", ""),
                "cost": data.get("cost"),
                "attack": data.get("attack"),
                "defense": data.get("defense"),
                "description": data.get("description") or "",
                "flavor": data.get("flavor") or "",
                "sha256": data.get("sha256"),
            }
        )
    return scans


def cluster_by_description(group):
    clusters = []
    for scan in group:
        best = None
        best_score = 0.0
        for cluster in clusters:
            score = max(sim(scan["description"], member["description"]) for member in cluster)
            if score > best_score:
                best_score = score
                best = cluster
        if best is not None and best_score >= 0.9:
            best.append(scan)
        else:
            clusters.append([scan])
    return clusters


def build_card(cluster, prefix):
    scans = sorted(cluster, key=lambda scan: natural(scan["stem"]))
    name = canonical_name(scans)
    cost = majority([scan["cost"] for scan in scans], scans[0]["cost"])
    description = medoid_description(scans)
    cost_matches = [scan for scan in scans if scan["cost"] == cost]
    name_matches = [scan for scan in cost_matches if scan["name"] == name] or cost_matches or scans
    representative = min(
        name_matches,
        key=lambda scan: (1 - sim(scan["description"], description), natural(scan["stem"])),
    )
    card_id = representative["stem"]
    sets = sorted({scan["pack"] for scan in scans})
    sources = sorted((scan["stem"] for scan in scans), key=natural)
    flavors = Counter(scan["flavor"] for scan in scans if scan["flavor"])
    flavor = flavors.most_common(1)[0][0] if flavors else representative["flavor"]
    types = Counter(scan["type"] for scan in scans)
    return {
        "id": card_id,
        "name": name,
        "type": types.most_common(1)[0][0],
        "typeCategory": scans[0]["typeCategory"],
        "landType": scans[0]["landType"],
        "cost": cost,
        "attack": scans[0]["attack"],
        "defense": scans[0]["defense"],
        "description": description,
        "flavor": flavor,
        "abilities": [],
        "image": f"{prefix}/cards/images/{card_id}.png",
        "deckSet": representative["pack"],
        "sets": sets,
        "sha256": representative["sha256"],
        "sources": sources,
    }, representative, scans


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=OUT)
    parser.add_argument("--prefix", default="/content")
    args = parser.parse_args()

    scans = load_scans()
    groups = defaultdict(list)
    for scan in scans:
        key = (
            norm_name(scan["name"]),
            scan["typeCategory"],
            scan["landType"],
            scan["attack"],
            scan["defense"],
        )
        groups[key].append(scan)

    cards = []
    entries = []
    split_groups = []
    for group in groups.values():
        group_clusters = cluster_by_description(group)
        if len(group_clusters) > 1:
            split_groups.append(group)
        for cluster in group_clusters:
            card, representative, cluster_scans = build_card(cluster, args.prefix)
            entries.append((card, representative, cluster_scans))

    entries.sort(key=lambda item: natural(item[0]["id"]))
    cards = [item[0] for item in entries]
    representatives = [item[1] for item in entries]
    clusters = [item[2] for item in entries]

    ids = {card["id"] for card in cards}
    if len(ids) != len(cards):
        raise SystemExit("duplicate card ids")

    if os.path.isdir(args.out):
        shutil.rmtree(args.out)
    shutil.copytree(os.path.join(OLD, "heroes", "images"), os.path.join(args.out, "heroes", "images"))
    shutil.copytree(os.path.join(OLD, "heroes", "heroes"), os.path.join(args.out, "heroes", "json"))
    shutil.copytree(os.path.join(OLD, "lands", "images"), os.path.join(args.out, "lands", "images"))
    shutil.copytree(os.path.join(OLD, "lands", "lands"), os.path.join(args.out, "lands", "json"))
    os.makedirs(os.path.join(args.out, "cards", "json"), exist_ok=True)
    os.makedirs(os.path.join(args.out, "cards", "images"), exist_ok=True)

    for card, representative in zip(cards, representatives):
        source_image = os.path.join(SRC, representative["stem"] + ".png")
        target_image = os.path.join(args.out, "cards", "images", card["id"] + ".png")
        shutil.copy2(source_image, target_image)
        digest = hashlib.sha256(open(target_image, "rb").read()).hexdigest()
        if card["sha256"] != digest:
            raise SystemExit(f"sha mismatch for {card['id']}")
        write_json(os.path.join(args.out, "cards", "json", card["id"] + ".json"), card)

    old_index = read_json(os.path.join(OLD, "index.json"))
    non_cards = [entry for entry in old_index if entry.get("kind") != "card"]
    card_entries = [
        {"id": card["id"], "name": card["name"], "deckSet": card["deckSet"], "image": card["image"], "kind": "card"}
        for card in cards
    ]
    index = card_entries + non_cards
    write_json(os.path.join(args.out, "index.json"), index)

    type_counts = Counter(card["typeCategory"] for card in cards)
    land_counts = Counter(card["landType"] for card in cards)
    merge_groups = [cluster for cluster in clusters if len(cluster) > 1]
    cost_conflicts = [
        cluster
        for cluster in clusters
        if len({scan["cost"] for scan in cluster}) > 1
    ]
    companion = [card for card in cards if card["typeCategory"] == "companion"]

    lines = [
        "# Сборка content-new",
        "",
        f"- Сканов: {len(scans)}",
        f"- Уникальных карт: {len(cards)} (старый каталог: 545)",
        f"- Групп с дублями: {len(merge_groups)}",
        f"- Групп, разделённых по описанию: {len(split_groups)}",
        f"- Групп с разной стоимостью: {len(cost_conflicts)}",
        f"- Партнёрских карт: {len(companion)}",
        f"- Типы: {dict(type_counts)}",
        f"- Земли: {dict(land_counts)}",
        "",
        "## Примеры объединений",
        "",
    ]
    for cluster in sorted(merge_groups, key=lambda c: -len(c))[:25]:
        lines.append(f"- {cluster[0]['name']}: {', '.join(sorted(scan['stem'] for scan in cluster))}")
    if split_groups:
        lines += ["", "## Разделены по описанию", ""]
        for group in split_groups[:25]:
            details = []
            by_desc = defaultdict(list)
            for scan in group:
                by_desc[norm_desc(scan["description"])].append(scan["stem"])
            for desc, stems in by_desc.items():
                details.append(f"{', '.join(stems)}")
            lines.append(f"- {group[0]['name']}: " + " | ".join(details))
    open(REPORT, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print(f"cards: {len(cards)} (scans {len(scans)}), companions: {len(companion)}")
    print(f"report: {REPORT}")
    print(f"output: {args.out}")


if __name__ == "__main__":
    main()
