import os
import sys
import json
import base64
import socket
import time
import urllib.request
import urllib.error

# Ensure IPv4
_orig = socket.getaddrinfo
socket.getaddrinfo = lambda *args, **kwargs: [r for r in _orig(*args, **kwargs) if r[0] == socket.AF_INET] or _orig(*args, **kwargs)

api_key = ''
for line in open('.env'):
    if line.strip().startswith('GEMINI_API_KEY='):
        api_key = line.strip().split('=', 1)[1].strip()

MODELS = [
    "gemini-3.1-flash-lite",
    "gemini-3.1-flash-lite-preview",
    "gemini-omni-1.1-flash",
    "gemini-omni-1.2-flash",
    "gemini-3.8-flash",
]
current_model_idx = 0

def check_one(stem):
    global current_model_idx
    img_p = os.path.join('исходники', 'Images', 'герои', f'{stem}.png')
    json_p = os.path.join('исходники', 'Images', 'герои', f'{stem}.json')
    with open(json_p, encoding='utf-8') as f:
        data = json.load(f)

    with open(img_p, 'rb') as f:
        img_b64 = base64.b64encode(f.read()).decode('utf-8')

    prompt = (
        "You are an expert card game OCR proofreader verifying image-to-JSON fidelity.\n"
        "Here is the current JSON record for this card:\n"
        f"{json.dumps(data, ensure_ascii=False, indent=2)}\n\n"
        "Carefully examine the card scan and check:\n"
        "1. Is 'name' exact letter-for-letter match with the card title?\n"
        "2. Is 'description' an exact verbatim match of the ability box text?\n"
        "3. Does the card have any sword (attack) or shield (defense) or cost numbers? (Hero cards usually do not, but check).\n"
        "4. Is 'set_code' faithful to any icon or badge at the bottom?\n\n"
        "Return a JSON object:\n"
        "{\n"
        '  "is_faithful": true/false,\n'
        '  "name_match": true/false,\n'
        '  "description_match": true/false,\n'
        '  "actual_title_on_card": "string",\n'
        '  "actual_description_on_card": "string",\n'
        '  "discrepancies": ["list of issues if any"],\n'
        '  "corrected_json": null or corrected JSON dict\n'
        "}\n"
        "Return ONLY pure JSON."
    )

    payload = {
        "contents": [{"parts": [{"text": prompt}, {"inline_data": {"mime_type": "image/png", "data": img_b64}}]}],
        "generationConfig": {"response_mime_type": "application/json", "temperature": 0.0}
    }
    req_data = json.dumps(payload).encode('utf-8')

    for attempt in range(10):
        model = MODELS[current_model_idx]
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        try:
            req = urllib.request.Request(url, data=req_data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                res = json.loads(resp.read().decode('utf-8'))
                text = res['candidates'][0]['content']['parts'][0]['text']
                return json.loads(text)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                current_model_idx = (current_model_idx + 1) % len(MODELS)
                time.sleep(2)
                continue
            time.sleep(2)
        except Exception as e:
            time.sleep(2)
    return None

def main():
    hero_dir = os.path.join('исходники', 'Images', 'герои')
    stems = [f[:-5] for f in sorted(os.listdir(hero_dir)) if f.endswith('.json')]
    print(f"Total heroes to audit: {len(stems)}")

    results = []
    issues_found = 0

    for i, s in enumerate(stems, 1):
        res = check_one(s)
        time.sleep(3.0)
        if not res:
            print(f"[{i}/{len(stems)}] {s[:16]} -> FAILED TO VERIFY")
            continue

        faithful = res.get("is_faithful", True)
        title = res.get("actual_title_on_card", "")
        disc = res.get("discrepancies", [])

        if not faithful or disc:
            issues_found += 1
            print(f"[{i}/{len(stems)}] {s[:16]} ({title}) -> ISSUES: {disc}")
            # If corrected_json provided, apply fix if reasonable
            if res.get("corrected_json"):
                json_p = os.path.join(hero_dir, f"{s}.json")
                cur = json.load(open(json_p, encoding='utf-8'))
                # update fields while preserving sha256
                c_json = res["corrected_json"]
                for k in ["name", "description", "flavor", "set_code"]:
                    if k in c_json and c_json[k]:
                        cur[k] = c_json[k]
                with open(json_p, 'w', encoding='utf-8') as out_f:
                    json.dump(cur, out_f, ensure_ascii=False, indent=2)
                print(f"    -> Applied corrections to {s[:16]}.json")
        else:
            print(f"[{i}/{len(stems)}] {s[:16]} ({title}) -> 100% FAITHFUL")

        results.append({
            "stem": s,
            "title": title,
            "faithful": faithful,
            "discrepancies": disc
        })

    os.makedirs('reports', exist_ok=True)
    with open('reports/heroes_fidelity_audit.json', 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"\nDone! Audited {len(stems)} heroes. Issues flagged: {issues_found}.")

if __name__ == '__main__':
    main()
