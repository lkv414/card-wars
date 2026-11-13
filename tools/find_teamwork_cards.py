import glob
import json
import os

def main():
    print("=== Scanning content-new for 2v2 and companion cards ===")
    companion_cards = []
    for f in glob.glob("content-new/cards/json/*.json"):
        with open(f, "r", encoding="utf-8") as fp:
            d = json.load(fp)
            cat = d.get("typeCategory")
            t = d.get("type", "")
            desc = d.get("description", "")
            if cat == "companion" or "партнер" in t.lower() or "партнер" in desc.lower() or "напарник" in desc.lower():
                companion_cards.append(d)

    print(f"Total found in content-new: {len(companion_cards)}")
    for c in companion_cards:
        print(f"  ID: {c.get('id')} - Name: {c.get('name')} ({c.get('name_en')}) - Type: {c.get('type')} - Cat: {c.get('typeCategory')}")

    print("\n=== Now scanning исходники/Images/карты/ for matching or 2v2 cards ===")
    img_cards = []
    for f in glob.glob("исходники/Images/карты/**/*.json", recursive=True):
        with open(f, "r", encoding="utf-8") as fp:
            d = json.load(fp)
            d["_file"] = f
            img_cards.append(d)

    print(f"Total cards in исходники/Images/карты: {len(img_cards)}")
    
    # Check by set_code == '2v2'
    set_2v2 = [c for c in img_cards if c.get("set_code") == "2v2"]
    print(f"Total set_code == 2v2: {len(set_2v2)}")

    # Check which cards have "напарник" in description or type containing "командн"
    potential_teamwork = []
    for c in img_cards:
        desc = c.get("description", "").lower()
        t = c.get("type", "").lower()
        cat = c.get("typeCategory", "").lower()
        name = c.get("name", "")
        name_en = str(c.get("name_en", "")).lower()
        
        # Check if description mentions напарник or партнер or if card is one of known teamwork cards
        if "напарник" in desc or "партнер" in desc or "командн" in t or cat == "companion" or cat == "teamwork":
            potential_teamwork.append(c)

    print(f"\nPotential teamwork cards based on text ('напарник' / 'партнер' / 'командн'): {len(potential_teamwork)}")
    for c in potential_teamwork:
        print(f"  File: {os.path.basename(c['_file'])}")
        print(f"    Name: {c.get('name')} ({c.get('name_en')})")
        print(f"    Type: {c.get('type')}, Category: {c.get('typeCategory')}, Set: {c.get('set_code')}")
        print(f"    Description: {c.get('description')[:80]}...")

if __name__ == "__main__":
    main()
