#!/usr/bin/env python3
"""
Пакетное перераспознавание карт с помощью Gemini Vision API (Free Tier).
- Поддерживает автоматическую ротацию моделей при исчерпании квоты на одной модели.
- Защита от зависаний сокетов и форсирование IPv4 через VPN.
- Соблюдает интервал 4.2с (15 RPM).
- Поддерживает возобновление (resume).
- Сохраняет результаты в `исходники/cards_reocr/`.
- Генерирует отчет об отличиях (diff_report.md).
"""

import os
import sys
import time
import json
import base64
import socket
import urllib.request
import urllib.error
import argparse
from datetime import datetime

# Защита от зависания TCP при обрыве интернета
socket.setdefaulttimeout(30)

# Принудительный IPv4 (устраняет 80-секундный тайм-аут IPv6 в WireGuard)
_orig_getaddrinfo = socket.getaddrinfo
def _getaddrinfo_v4(*args, **kwargs):
    responses = _orig_getaddrinfo(*args, **kwargs)
    v4 = [r for r in responses if r[0] == socket.AF_INET]
    return v4 if v4 else responses
socket.getaddrinfo = _getaddrinfo_v4

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_CARDS_DIR = os.path.join(ROOT_DIR, "исходники", "карты")
OUT_CARDS_DIR = os.path.join(ROOT_DIR, "исходники", "cards_reocr")
ENV_FILE = os.path.join(ROOT_DIR, ".env")
REPORT_FILE = os.path.join(OUT_CARDS_DIR, "diff_report.md")

MODELS = [
    "gemini-3.1-flash-lite",
    "gemini-3.1-flash-lite-preview",
    "gemini-omni-1.1-flash",
    "gemini-omni-1.2-flash",
    "gemini-3.8-flash",
]
current_model_idx = 0


def load_api_key():
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("GEMINI_API_KEY="):
                    return line.split("=", 1)[1].strip()
    return os.environ.get("GEMINI_API_KEY", "")


def get_prompt(card_name):
    return f"""Ты профессиональный OCR-верификатор по карточной игре "Время Приключений: Карточные Войны" (Adventure Time Card Wars).
Тебе дано изображение карты. Проверенное название карты на русском: "{card_name}".

Извлеки информацию с карты строго в формате JSON:
{{
  "name_ru": "{card_name}",
  "name_en": string,
  "cost": int,
  "land_type": string,
  "type": string,
  "attack": int | null,
  "defense": int | null,
  "description": string,
  "flavor": string,
  "set_code": string
}}

КРИТИЧЕСКИЕ ТРЕБОВАНИЯ:
1. description: ДОСЛОВНЫЙ текст свойства со скана. Переписывай СТРОГО символ в символ, со всеми переносами строк (\\n), знаками препинания, стрелочками (>>>), ключевыми словами (ПРИЕМ, ФЛЮП и т.д.). ЗАПРЕЩЕНО сокращать, обобщать или перефразировать текст!
2. attack / defense: целые числа если внизу слева/справа есть значки меча/щита с числом. Если это заклинание/строение и значков нет — строго null.
3. cost: число в кружке вверху слева.
4. land_type: тип земли по иконке вверху справа (Кукурузные поля / Синие равнины / Бесполезные болота / Песчаные земли / Ледяные земли / Радужные земли / Милые земли).
5. type: строка типа под артворком (например: "Болотное существо", "Радужное заклинание", "Кукурузное строение").
6. name_en: английское название на верхней чёрной плашке (например: "DR. DEATH", "BONE WAND").
7. set_code: код внизу карты со значком (например: "CP2", "FTG", "FCP 6").
8. flavor: художественный курсивный текст внизу (если есть), иначе пустая строка "".

Отвечай ТОЛЬКО чистым валидным JSON без markdown-разметки backticks."""


def call_gemini(api_key, image_bytes, card_name, max_retries=10):
    global current_model_idx
    img_b64 = base64.b64encode(image_bytes).decode("utf-8")
    prompt = get_prompt(card_name)

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                    {
                        "inline_data": {
                            "mime_type": "image/png",
                            "data": img_b64,
                        }
                    },
                ]
            }
        ],
        "generationConfig": {
            "response_mime_type": "application/json",
            "temperature": 0.0,
        },
    }
    req_data = json.dumps(payload).encode("utf-8")

    for attempt in range(max_retries):
        model_name = MODELS[current_model_idx]
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"

        try:
            req = urllib.request.Request(
                url, data=req_data, headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                res = json.loads(resp.read().decode("utf-8"))
                text = res["candidates"][0]["content"]["parts"][0]["text"]
                return json.loads(text)
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="ignore")
            # Если суточная квота на эту модель кончилась
            if e.code == 429 and ("limit exceeded on Free Tier" in err_body or "quota exceeded" in err_body.lower()):
                prev_model = model_name
                current_model_idx = (current_model_idx + 1) % len(MODELS)
                next_model = MODELS[current_model_idx]
                print(f"\n[Квота {prev_model} исчерпана -> Переключаюсь на {next_model}]")
                time.sleep(2)
                continue
            elif e.code == 429:
                # Обычный минутный RPM
                wait_time = (attempt % 3 + 1) * 10
                print(f"\n[RPM пауза {wait_time}с на {model_name}]")
                time.sleep(wait_time)
            elif e.code in (503, 500, 502):
                # Перегрузка модели -> пробуем следующую
                prev_model = model_name
                current_model_idx = (current_model_idx + 1) % len(MODELS)
                next_model = MODELS[current_model_idx]
                print(f"\n[Сервер {prev_model} {e.code} -> Пробую {next_model}]")
                time.sleep(3)
                continue
            else:
                raise RuntimeError(f"HTTP {e.code}: {err_body}")
        except Exception as e:
            print(f"\n[Сетевая заминка: {e}] Повтор...")
            time.sleep(3)

    raise RuntimeError("Не удалось получить ответ от всех доступных моделей")


def main():
    parser = argparse.ArgumentParser(description="Re-OCR cards using Gemini Vision")
    parser.add_argument("--limit", type=int, default=0, help="Ограничить количество карт")
    parser.add_argument("--delay", type=float, default=4.2, help="Задержка между запросами в секундах")
    parser.add_argument("--prefix", type=str, default="", help="Фильтр по префиксу файла")
    args = parser.parse_args()

    api_key = load_api_key()
    if not api_key:
        print("ОШИБКА: Не найден GEMINI_API_KEY в файле .env")
        sys.exit(1)

    os.makedirs(OUT_CARDS_DIR, exist_ok=True)

    all_files = sorted(os.listdir(SRC_CARDS_DIR))
    json_files = [f for f in all_files if f.endswith(".json")]

    if args.prefix:
        json_files = [f for f in json_files if f.startswith(args.prefix)]

    if args.limit > 0:
        json_files = json_files[:args.limit]

    total = len(json_files)
    print(f"=== Запуск Re-OCR (Карт в плане: {total}, Пауза: {args.delay}с) ===")

    processed = 0
    skipped = 0
    diffs = []

    for idx, j_name in enumerate(json_files, 1):
        stem = j_name[:-5]
        png_name = stem + ".png"
        src_json_path = os.path.join(SRC_CARDS_DIR, j_name)
        src_png_path = os.path.join(SRC_CARDS_DIR, png_name)
        out_json_path = os.path.join(OUT_CARDS_DIR, j_name)

        if not os.path.exists(src_png_path):
            print(f"[{idx}/{total}] Пропуск: нет картинки для {stem}")
            continue

        # Чекпоинт
        if os.path.exists(out_json_path):
            try:
                with open(out_json_path, encoding="utf-8") as f:
                    cached = json.load(f)
                if cached.get("description") is not None:
                    skipped += 1
                    continue
            except Exception:
                pass

        # Читаем проверенный json с названием
        with open(src_json_path, encoding="utf-8") as f:
            src_data = json.load(f)
        card_name = src_data.get("name", "")

        with open(src_png_path, "rb") as f:
            png_bytes = f.read()

        active_model = MODELS[current_model_idx]
        print(f"[{idx}/{total}] {stem} («{card_name}»)...", end="", flush=True)

        try:
            start_t = time.time()
            result = call_gemini(api_key, png_bytes, card_name)
            elapsed = time.time() - start_t

            with open(out_json_path, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False, indent=2)

            old_desc = (src_data.get("description") or "").strip()
            new_desc = (result.get("description") or "").strip()

            diff_status = "OK"
            if old_desc != new_desc:
                diff_status = "DIFF"
                diffs.append({
                    "stem": stem,
                    "name": card_name,
                    "old_desc": old_desc,
                    "new_desc": new_desc,
                    "old_atk": src_data.get("attack"),
                    "new_atk": result.get("attack"),
                    "old_def": src_data.get("defense"),
                    "new_def": result.get("defense"),
                })

            print(f" [{diff_status}] ({elapsed:.1f}с, {active_model})")
            processed += 1

            time.sleep(args.delay)

        except Exception as e:
            print(f" [ОШИБКА: {e}]")
            time.sleep(5)

    print(f"\nЗавершено! Новых: {processed}, Пропущено (ранее сохранены): {skipped}")

    if diffs:
        with open(REPORT_FILE, "a", encoding="utf-8") as f:
            f.write(f"\n\n## Отчет за {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
            for d in diffs:
                f.write(f"### {d['stem']} — «{d['name']}»\n")
                if d['old_atk'] != d['new_atk'] or d['old_def'] != d['new_def']:
                    f.write(f"- **Статы было:** ATK={d['old_atk']} / DEF={d['old_def']} ➔ **стало:** ATK={d['new_atk']} / DEF={d['new_def']}\n")
                f.write(f"- **Было:** `{d['old_desc']}`\n")
                f.write(f"- **Стало:** `{d['new_desc']}`\n\n")
        print(f"Отчет об отличиях дополнен в: {REPORT_FILE}")


if __name__ == "__main__":
    main()
