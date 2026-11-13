#!/usr/bin/env python3
"""
Automated Batch OCR & Metadata Generator for High-Res Adventure Time Card Wars scans.

Features:
- Takes any image from исходники/Images/ (PNG or JPG).
- Computes exact SHA256 of the image.
- Matches against existing catalog data (content-new/, исходники/cards.json, исходники/cards_reocr/).
- Calls Gemini Vision API (Free Tier with model rotation, IPv4 forcing, retry logic).
- Merges extracted visual fields with catalog metadata when available.
- Writes <stem>.json in the same directory next to the image.
- Full compatibility with tools/verify_images_ocr.py.
- Supports resuming (--resume), rate pacing (--delay), agent-based batching (--agent), and directory filtering (--dir).
"""

import os
import subprocess
import sys
import time
import json
import base64
import socket
import hashlib
import argparse
import urllib.request
import urllib.error
from typing import Dict, List, Optional, Tuple, Any

# Ensure IPv4 resolution (bypasses 80s IPv6 WireGuard DNS timeout on Windows)
socket.setdefaulttimeout(30)
_orig_getaddrinfo = socket.getaddrinfo

def _getaddrinfo_v4(*args, **kwargs):
    responses = _orig_getaddrinfo(*args, **kwargs)
    v4 = [r for r in responses if r[0] == socket.AF_INET]
    return v4 if v4 else responses

socket.getaddrinfo = _getaddrinfo_v4

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES_DIR = os.path.join(ROOT_DIR, "исходники", "Images")
ENV_FILE = os.path.join(ROOT_DIR, ".env")
CONTENT_NEW_DIR = os.path.join(ROOT_DIR, "content-new")
CARDS_REOCR_DIR = os.path.join(ROOT_DIR, "исходники", "cards_reocr")
CARDS_JSON_PATH = os.path.join(ROOT_DIR, "исходники", "cards.json")
CARDS_SRC_DIR = os.path.join(ROOT_DIR, "исходники", "карты")

MODELS = [
    "gemini-3.5-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-3.5-flash",
    "gemini-3.6-flash",
]
current_model_idx = 0

AGENT_DIRECTORIES = {
    "ocr-heroes-lands": [
        os.path.join(IMAGES_DIR, "герои"),
        os.path.join(IMAGES_DIR, "земли"),
        os.path.join(IMAGES_DIR, "прочее"),
    ],
    "ocr-cards-1": [
        os.path.join(IMAGES_DIR, "карты", "болотные"),
        os.path.join(IMAGES_DIR, "карты", "добрые"),
        os.path.join(IMAGES_DIR, "карты", "кукурузные"),
        os.path.join(IMAGES_DIR, "карты", "лавовые"),
    ],
    "ocr-cards-2": [
        os.path.join(IMAGES_DIR, "карты", "ледяные"),
        os.path.join(IMAGES_DIR, "карты", "песчаные"),
        os.path.join(IMAGES_DIR, "карты", "радужные"),
        os.path.join(IMAGES_DIR, "карты", "синие равнины"),
        os.path.join(IMAGES_DIR, "карты", "хеллоуинские"),
    ],
}

FOLDER_LAND_TYPES = {
    "болотные": ("swamp", "Бесполезные болота"),
    "добрые": ("nice", "Милые земли"),
    "кукурузные": ("corn", "Кукурузные поля"),
    "лавовые": ("lava", "Лавовые земли"),
    "ледяные": ("icy", "Ледяные земли"),
    "песчаные": ("sandy", "Песчаные земли"),
    "радужные": ("rainbow", "Радужные земли"),
    "синие равнины": ("blue", "Синие равнины"),
    "хеллоуинские": ("ghost", "Призрачные земли"),
}


def load_api_key() -> str:
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("GEMINI_API_KEY="):
                    return line.split("=", 1)[1].strip()
    return os.environ.get("GEMINI_API_KEY", "")


def compute_sha256(path: str) -> str:
    hasher = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def normalize_text(text: Optional[str]) -> str:
    if not text:
        return ""
    t = text.lower().replace("ё", "е")
    t = "".join(ch if ch.isalnum() else " " for ch in t)
    return " ".join(t.split())


class CatalogIndex:
    def __init__(self):
        self.by_name: Dict[str, Dict[str, Any]] = {}
        self.by_name_en: Dict[str, Dict[str, Any]] = {}
        self.by_sha256: Dict[str, Dict[str, Any]] = {}
        self._loaded = False

    def load(self):
        if self._loaded:
            return
        
        # 1. content-new cards
        cards_dir = os.path.join(CONTENT_NEW_DIR, "cards", "json")
        if os.path.exists(cards_dir):
            for fname in os.listdir(cards_dir):
                if fname.endswith(".json"):
                    try:
                        with open(os.path.join(cards_dir, fname), encoding="utf-8") as f:
                            data = json.load(f)
                            self._index_entry(data, source="content-new-card")
                    except Exception:
                        pass

        # 2. content-new heroes
        heroes_dir = os.path.join(CONTENT_NEW_DIR, "heroes", "json")
        if os.path.exists(heroes_dir):
            for fname in os.listdir(heroes_dir):
                if fname.endswith(".json"):
                    try:
                        with open(os.path.join(heroes_dir, fname), encoding="utf-8") as f:
                            data = json.load(f)
                            self._index_entry(data, source="content-new-hero")
                    except Exception:
                        pass

        # 3. content-new lands
        lands_dir = os.path.join(CONTENT_NEW_DIR, "lands", "json")
        if os.path.exists(lands_dir):
            for fname in os.listdir(lands_dir):
                if fname.endswith(".json"):
                    try:
                        with open(os.path.join(lands_dir, fname), encoding="utf-8") as f:
                            data = json.load(f)
                            self._index_entry(data, source="content-new-land")
                    except Exception:
                        pass

        # 4. cards_reocr
        if os.path.exists(CARDS_REOCR_DIR):
            for fname in os.listdir(CARDS_REOCR_DIR):
                if fname.endswith(".json"):
                    try:
                        with open(os.path.join(CARDS_REOCR_DIR, fname), encoding="utf-8") as f:
                            data = json.load(f)
                            entry = {
                                "name": data.get("name_ru"),
                                "name_en": data.get("name_en"),
                                "type": data.get("type"),
                                "cost": data.get("cost"),
                                "attack": data.get("attack"),
                                "defense": data.get("defense"),
                                "description": data.get("description"),
                                "flavor": data.get("flavor", ""),
                                "set_code": data.get("set_code", ""),
                                "land_type": data.get("land_type"),
                            }
                            self._index_entry(entry, source="cards_reocr")
                    except Exception:
                        pass

        # 5. исходники/cards.json
        if os.path.exists(CARDS_JSON_PATH):
            try:
                with open(CARDS_JSON_PATH, encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        for k, v in data.items():
                            entry = {
                                "name": v.get("name"),
                                "cost": v.get("cost"),
                                "attack": v.get("attack"),
                                "defense": v.get("health"),
                                "type": v.get("card_type"),
                                "land_type": v.get("land_type"),
                                "description": v.get("description"),
                            }
                            self._index_entry(entry, source="cards.json")
            except Exception:
                pass

        self._loaded = True

    def _index_entry(self, data: Dict[str, Any], source: str):
        sha = data.get("sha256")
        if sha and sha not in self.by_sha256:
            self.by_sha256[sha] = data

        name = data.get("name") or data.get("name_ru")
        if name:
            norm = normalize_text(name)
            if norm and norm not in self.by_name:
                self.by_name[norm] = data

        name_en = data.get("name_en")
        if name_en:
            norm_en = normalize_text(name_en)
            if norm_en and norm_en not in self.by_name_en:
                self.by_name_en[norm_en] = data

    def match(self, sha256: Optional[str] = None, name: Optional[str] = None, name_en: Optional[str] = None) -> Optional[Dict[str, Any]]:
        if sha256 and sha256 in self.by_sha256:
            return self.by_sha256[sha256]
        if name:
            norm = normalize_text(name)
            if norm in self.by_name:
                return self.by_name[norm]
        if name_en:
            norm_en = normalize_text(name_en)
            if norm_en in self.by_name_en:
                return self.by_name_en[norm_en]
        return None


def get_image_category_info(image_path: str) -> Tuple[str, str, Optional[str], Optional[str]]:
    """
    Returns (category, typeCategory, land_code, land_name)
    category in ('hero', 'land', 'card', 'other')
    """
    rel = os.path.relpath(image_path, IMAGES_DIR)
    parts = os.path.normpath(rel).split(os.sep)

    top = parts[0] if parts else ""
    if top == "герои":
        return ("hero", "hero", None, None)
    elif top == "земли":
        return ("land", "land", None, None)
    elif top == "прочее":
        return ("other", "back", None, None)
    elif top == "карты":
        sub = parts[1] if len(parts) > 1 else ""
        land_info = FOLDER_LAND_TYPES.get(sub, (None, None))
        return ("card", "creature", land_info[0], land_info[1])
    return ("unknown", "unknown", None, None)


def build_prompt(category: str, land_name_hint: Optional[str]) -> str:
    if category == "hero":
        return """Ты профессиональный OCR-верификатор по карточной игре "Время Приключений: Карточные Войны" (Adventure Time Card Wars).
Тебе дано изображение карты героя (или оборотной стороны).
Извлеки информацию строго в формате JSON:
{
  "name": string,
  "name_en": string,
  "type": "Герой",
  "typeCategory": "hero",
  "description": string,
  "flavor": string,
  "set_code": string | null
}
КРИТИЧЕСКИЕ ТРЕБОВАНИЯ:
1. name: Точное имя героя на русском со скана.
2. name_en: Английское имя героя (если указано на карте или официальный перевод).
3. description: ДОСЛОВНЫЙ текст способности со скана. Переписывай СТРОГО символ в символ со всеми переносами строк (\\n), стрелочками (>>>) и знаками препинания. ЗАПРЕЩЕНО сокращать или перефразировать текст!
4. flavor: художественный курсивный текст внизу (если есть), иначе пустая строка "".
5. set_code: код сета со значком внизу карты (например "FTG", "CP2", "КИКСТАРТЕР", "PC"), иначе null.
Отвечай ТОЛЬКО чистым валидным JSON без markdown разметки."""

    elif category == "land":
        return """Ты профессиональный OCR-верификатор по карточной игре "Время Приключений: Карточные Войны" (Adventure Time Card Wars).
Тебе дано изображение карты земли (или оборотной стороны).
Извлеки информацию строго в формате JSON:
{
  "name": string,
  "name_en": string,
  "type": "Земля" | "Рубашка",
  "typeCategory": "land" | "back",
  "landType": string | null,
  "description": string,
  "flavor": string,
  "set_code": string | null
}
КРИТИЧЕСКИЕ ТРЕБОВАНИЯ:
1. name: Точное название земли на русском (например: "Кукурузные поля", "Синие равнины", "Бесполезные болота", "Песчаные земли", "Ледяные земли", "Радужные земли", "Милые земли", "Лавовые земли", "Рубашка земель").
2. name_en: Английское название (Cornfield, Blue Plains, Useless Swamps, Sandy Lands, Icy Lands, Rainbow Lands, Nice Lands, Lava Lands, Land Back).
3. landType: короткий код (corn, blue, swamp, sandy, icy, rainbow, nice, lava), либо null для рубашки.
4. description: текст свойства если есть, иначе пустая строка "".
5. flavor: пустая строка "" если нет.
Отвечай ТОЛЬКО чистым валидным JSON без markdown разметки."""

    elif category == "other":
        return """Ты профессиональный OCR-верификатор по карточной игре "Время Приключений: Карточные Войны" (Adventure Time Card Wars).
Тебе дано изображение игрового элемента или рубашки карт.
Извлеки информацию строго в формате JSON:
{
  "name": string,
  "name_en": string,
  "type": string,
  "typeCategory": "back" | "token" | "other",
  "description": string,
  "flavor": string,
  "set_code": string | null
}
Отвечай ТОЛЬКО чистым валидным JSON без markdown разметки."""

    else:
        # Standard card
        hint_str = f' Подсказка: эта карта находится в категории "{land_name_hint}", но проверь реальную иконку земли в правом верхнем углу (Призрачные земли, Радужные земли, Кукурузные поля, Бесполезные болота, Синие равнины, Песчаные земли, Ледяные земли, Милые земли, Лавовые земли).' if land_name_hint else ""
        return f"""Ты профессиональный OCR-верификатор по карточной игре "Время Приключений: Карточные Войны" (Adventure Time Card Wars).{hint_str}
Тебе дано изображение карты.
Извлеки информацию со скана карты строго в формате JSON:
{{
  "name": string,
  "name_en": string,
  "cost": int | null,
  "land_type": string,
  "landType": "corn" | "swamp" | "blue" | "sandy" | "icy" | "rainbow" | "nice" | "lava" | "ghost",
  "type": string,
  "typeCategory": "creature" | "spell" | "building",
  "attack": int | null,
  "defense": int | null,
  "description": string,
  "flavor": string,
  "set_code": string | null
}}
КРИТИЧЕСКИЕ ТРЕБОВАНИЯ:
1. name: Точное название карты на русском с верхней плашки.
2. name_en: Английское название на чёрной верхней плашке (например: "CORN RONIN", "BONE WAND", "SATAN'S GOAT"), если нет — пустая строка "".
3. cost: Число в кружке вверху слева (целое неотрицательное число).
4. land_type: Тип земли по иконке вверху справа (Кукурузные поля / Синие равнины / Бесполезные болота / Песчаные земли / Ледяные земли / Радужные земли / Милые земли / Лавовые земли / Призрачные земли).
5. landType: Код типа земли: corn, swamp, blue, sandy, icy, rainbow, nice, lava, ghost.
6. type: Строка типа под артворком (например: "Кукурузное существо", "Радужное заклинание", "Болотное строение", "Призрачное существо").
7. typeCategory: Категория карты: "creature" (для существ), "spell" (для заклинаний), "building" (для строений).
8. attack / defense: Числа в значках меча (атака) и щита (защита) внизу карты. Если это заклинание или строение без этих значков — строго null.
9. description: ДОСЛОВНЫЙ текст свойства со скана. Переписывай СТРОГО символ в символ со всеми переносами строк (\\n), стрелочками (>>>), знаками препинания и ключевыми словами (ФЛЮП, ПРИЕМ). ЗАПРЕЩЕНО сокращать или перефразировать текст!
10. flavor: Курсивный художественный текст внизу (если есть), иначе пустая строка "".
11. set_code: Код внизу карты со значком (например: "CP2", "FTG", "FCP 6", "КИКСТАРТЕР"), иначе null.
Отвечай ТОЛЬКО чистым валидным JSON без markdown разметки."""


def call_gemini_vision(api_key: str, image_bytes: bytes, mime_type: str, prompt: str, max_retries: int = 50) -> Dict[str, Any]:
    global current_model_idx

    img_b64 = base64.b64encode(image_bytes).decode("utf-8")
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                    {
                        "inline_data": {
                            "mime_type": mime_type,
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
            with urllib.request.urlopen(req, timeout=15) as resp:
                res = json.loads(resp.read().decode("utf-8"))
                text = res["candidates"][0]["content"]["parts"][0]["text"]
                return json.loads(text)
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="ignore")
            # Daily limit or quota exhaustion -> switch to next model immediately
            if e.code == 429 and ("limit exceeded" in err_body.lower() or "quota exceeded" in err_body.lower()):
                prev_model = model_name
                current_model_idx = (current_model_idx + 1) % len(MODELS)
                next_model = MODELS[current_model_idx]
                print(f"\n[Квота {prev_model} исчерпана -> Переключаюсь на {next_model}]")
                if current_model_idx == 0:
                    print("\n[Все модели исчерпаны/ограничены -> Пауза 20с для сброса окна квоты...]")
                    time.sleep(20)
                else:
                    time.sleep(2)
                continue
            elif e.code == 429:
                wait_time = (attempt % 3 + 1) * 8
                print(f"\n[RPM пауза {wait_time}с на {model_name}]")
                current_model_idx = (current_model_idx + 1) % len(MODELS)
                time.sleep(wait_time)
            elif e.code in (500, 502, 503):
                prev_model = model_name
                current_model_idx = (current_model_idx + 1) % len(MODELS)
                next_model = MODELS[current_model_idx]
                print(f"\n[Сервер {prev_model} {e.code} -> Пробую {next_model}]")
                time.sleep(3)
                continue
            else:
                raise RuntimeError(f"HTTP {e.code}: {err_body}")
        except Exception as e:
            prev_model = model_name
            current_model_idx = (current_model_idx + 1) % len(MODELS)
            next_model = MODELS[current_model_idx]
            print(f"\n[Ошибка {prev_model}: {e} -> Пробую {next_model}]")
            time.sleep(2)

    raise RuntimeError("Не удалось получить ответ от всех доступных моделей Gemini Vision")


def process_image(
    image_path: str,
    api_key: str,
    catalog: CatalogIndex,
    delay: float = 4.0,
    force_api: bool = False,
    dry_run: bool = False,
    verbose: bool = False,
) -> Tuple[bool, str, Dict[str, Any]]:
    """
    Process a single image:
    1. Compute exact sha256.
    2. Check match with catalog.
    3. Call Gemini Vision API if needed or requested.
    4. Save <stem>.json.
    """
    stem, ext = os.path.splitext(image_path)
    json_path = stem + ".json"
    mime_type = "image/jpeg" if ext.lower() in (".jpg", ".jpeg") else "image/png"

    # Compute SHA256
    file_sha256 = compute_sha256(image_path)

    # Determine category
    category, default_type_category, land_code, land_name_hint = get_image_category_info(image_path)

    # Check catalog match by sha256 first
    matched = catalog.match(sha256=file_sha256)
    
    ocr_result = {}
    if matched and not force_api:
        if verbose:
            print(f"  [Каталог SHA256 совпадение]: {matched.get('name')}")
        ocr_result = dict(matched)
    else:
        # Compress in memory for fast API transmission (original file on disk unchanged)
        try:
            from PIL import Image
            import io
            im = Image.open(image_path)
            if im.mode != "RGB":
                im = im.convert("RGB")
            max_dim = 1200
            if max(im.size) > max_dim:
                ratio = max_dim / max(im.size)
                im = im.resize((int(im.width * ratio), int(im.height * ratio)), Image.Resampling.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=85)
            image_bytes = buf.getvalue()
            mime_type = "image/jpeg"
        except Exception:
            with open(image_path, "rb") as f:
                image_bytes = f.read()

        prompt = build_prompt(category, land_name_hint)
        data = call_gemini_vision(api_key, image_bytes, mime_type, prompt)
        if isinstance(data, list) and len(data) > 0:
            data = data[0]
        ocr_result = data

        # Check if extracted name matches catalog
        name = ocr_result.get("name")
        name_en = ocr_result.get("name_en")
        matched_by_name = catalog.match(name=name, name_en=name_en)

        if matched_by_name:
            if verbose:
                print(f"  [Каталог совпадение по имени]: {matched_by_name.get('name')} (en: {matched_by_name.get('name_en')})")
            # Enrich fields if missing in OCR
            if not ocr_result.get("name_en") and matched_by_name.get("name_en"):
                ocr_result["name_en"] = matched_by_name["name_en"]
            if not ocr_result.get("set_code") and (matched_by_name.get("set_code") or matched_by_name.get("deckSet")):
                ocr_result["set_code"] = matched_by_name.get("set_code") or matched_by_name.get("deckSet")
            if "typeCategory" not in ocr_result and matched_by_name.get("typeCategory"):
                ocr_result["typeCategory"] = matched_by_name["typeCategory"]
            if "flavor" not in ocr_result and matched_by_name.get("flavor"):
                ocr_result["flavor"] = matched_by_name["flavor"]

    # Ensure required fields and exact sha256
    ocr_result["sha256"] = file_sha256

    if "name" not in ocr_result or not ocr_result["name"]:
        ocr_result["name"] = ocr_result.get("name_ru") or "Без названия"

    if "type" not in ocr_result or not ocr_result["type"]:
        if category == "hero":
            ocr_result["type"] = "Герой"
        elif category == "land":
            ocr_result["type"] = "Земля"
        elif category == "other":
            ocr_result["type"] = "Рубашка"
        else:
            ocr_result["type"] = "Существо"

    if "typeCategory" not in ocr_result or not ocr_result["typeCategory"]:
        ocr_result["typeCategory"] = default_type_category

    if category in ("card", "hero", "land"):
        if "description" not in ocr_result or ocr_result["description"] is None:
            ocr_result["description"] = ""
        if "name_en" not in ocr_result or ocr_result["name_en"] is None:
            ocr_result["name_en"] = ""
        if "flavor" not in ocr_result or ocr_result["flavor"] is None:
            ocr_result["flavor"] = ""
        if ocr_result.get("set_code") == "":
            ocr_result["set_code"] = None

    if category == "card":
        # Deduce landType accurately from land_type or type
        lt_str = (
            (ocr_result.get("land_type") or "") + " " + (ocr_result.get("type") or "")
        ).lower()
        if "кукуруз" in lt_str:
            ocr_result["landType"] = "corn"
            if not ocr_result.get("land_type"):
                ocr_result["land_type"] = "Кукурузные поля"
        elif "болот" in lt_str:
            ocr_result["landType"] = "swamp"
            if not ocr_result.get("land_type"):
                ocr_result["land_type"] = "Бесполезные болота"
        elif "син" in lt_str:
            ocr_result["landType"] = "blue"
            if not ocr_result.get("land_type"):
                ocr_result["land_type"] = "Синие равнины"
        elif "песч" in lt_str:
            ocr_result["landType"] = "sandy"
            if not ocr_result.get("land_type"):
                ocr_result["land_type"] = "Песчаные земли"
        elif "лед" in lt_str:
            ocr_result["landType"] = "icy"
            if not ocr_result.get("land_type"):
                ocr_result["land_type"] = "Ледяные земли"
        elif "радуж" in lt_str:
            ocr_result["landType"] = "rainbow"
            if not ocr_result.get("land_type"):
                ocr_result["land_type"] = "Радужные земли"
        elif "мил" in lt_str:
            ocr_result["landType"] = "nice"
            if not ocr_result.get("land_type"):
                ocr_result["land_type"] = "Милые земли"
        elif "лав" in lt_str:
            ocr_result["landType"] = "lava"
            if not ocr_result.get("land_type"):
                ocr_result["land_type"] = "Лавовые земли"
        elif "призрак" in lt_str or "призрач" in lt_str:
            ocr_result["landType"] = "ghost"
            if not ocr_result.get("land_type"):
                ocr_result["land_type"] = "Призрачные земли"
        else:
            if not ocr_result.get("landType"):
                ocr_result["landType"] = land_code
            if not ocr_result.get("land_type"):
                ocr_result["land_type"] = land_name_hint or ""

        # Normalize int / null fields
        tc = ocr_result.get("typeCategory")
        if tc in ("spell", "building"):
            ocr_result["attack"] = None
            ocr_result["defense"] = None
        else:
            if ocr_result.get("attack") is not None:
                try:
                    ocr_result["attack"] = int(ocr_result["attack"])
                except Exception:
                    pass
            if ocr_result.get("defense") is not None:
                try:
                    ocr_result["defense"] = int(ocr_result["defense"])
                except Exception:
                    pass

        if ocr_result.get("cost") is not None:
            try:
                ocr_result["cost"] = int(ocr_result["cost"])
            except Exception:
                pass

    if not dry_run:
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(ocr_result, f, ensure_ascii=False, indent=2)

    return True, json_path, ocr_result


def collect_images_to_process(
    target_path: Optional[str] = None,
    agent: Optional[str] = None,
    resume: bool = True,
    limit: int = 0,
) -> List[str]:
    """Collect image paths based on criteria."""
    targets = []

    if target_path:
        full_target = os.path.abspath(target_path)
        if os.path.isfile(full_target):
            targets.append(full_target)
        elif os.path.isdir(full_target):
            for root, _, files in os.walk(full_target):
                for f in sorted(files):
                    if f.lower().endswith((".png", ".jpg", ".jpeg")):
                        targets.append(os.path.join(root, f))
    elif agent:
        dirs = AGENT_DIRECTORIES.get(agent, [])
        for d in dirs:
            if os.path.exists(d):
                for root, _, files in os.walk(d):
                    for f in sorted(files):
                        if f.lower().endswith((".png", ".jpg", ".jpeg")):
                            targets.append(os.path.join(root, f))
    else:
        # Default: all images in исходники/Images
        for root, _, files in os.walk(IMAGES_DIR):
            for f in sorted(files):
                if f.lower().endswith((".png", ".jpg", ".jpeg")):
                    targets.append(os.path.join(root, f))

    if resume:
        filtered = []
        for img in targets:
            stem = os.path.splitext(img)[0]
            jpath = stem + ".json"
            if os.path.exists(jpath):
                try:
                    with open(jpath, encoding="utf-8") as f:
                        data = json.load(f)
                        if data.get("sha256") and data.get("name") and data.get("type"):
                            continue  # Valid JSON already exists, skip
                except Exception:
                    pass
            filtered.append(img)
        targets = filtered

    if limit > 0:
        targets = targets[:limit]

    return targets


def main():
    parser = argparse.ArgumentParser(description="Automated Batch OCR & Metadata Generator for High-Res Scans")
    parser.add_argument("target", nargs="?", default="", help="Directory or file to process")
    parser.add_argument("--dir", type=str, default="", help="Specific directory to process")
    parser.add_argument("--file", type=str, default="", help="Specific file to process")
    parser.add_argument("--agent", type=str, choices=list(AGENT_DIRECTORIES.keys()), help="Process batch for specific agent")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of images to process")
    parser.add_argument("--delay", type=float, default=4.0, help="Delay between API calls in seconds (default: 4.0)")
    parser.add_argument("--resume", action="store_true", default=True, help="Skip images that already have valid .json (default: True)")
    parser.add_argument("--no-resume", dest="resume", action="store_false", help="Do not skip existing .json files")
    parser.add_argument("--force-api", action="store_true", help="Always invoke Gemini Vision API even if catalog matches")
    parser.add_argument("--dry-run", action="store_true", help="Do not write output files")
    parser.add_argument("--verify", action="store_true", help="Run tools/verify_images_ocr.py after completion")
    parser.add_argument("--model-idx", type=int, default=0, help="Initial model index to use from MODELS list")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose logging")
    args = parser.parse_args()

    global current_model_idx
    current_model_idx = args.model_idx % len(MODELS)

    api_key = load_api_key()
    if not api_key:
        print("ОШИБКА: Не найден GEMINI_API_KEY в файле .env или переменных окружения.")
        sys.exit(1)

    target_path = args.file or args.dir or args.target

    print("=== Loading Catalog Index (content-new/, cards_reocr/, cards.json)... ===")
    catalog = CatalogIndex()
    catalog.load()
    print(f"Catalog indexed: {len(catalog.by_name)} named cards, {len(catalog.by_sha256)} sha256 entries.")

    images = collect_images_to_process(
        target_path=target_path,
        agent=args.agent,
        resume=args.resume,
        limit=args.limit,
    )

    total = len(images)
    print(f"=== Found {total} images to process (delay: {args.delay}s, agent: {args.agent or 'all'}) ===")
    if total == 0:
        print("No pending images to process. Everything is up to date!")
        if args.verify:
            verify_script = os.path.join(ROOT_DIR, "tools", "verify_images_ocr.py")
            subprocess.run([sys.executable, verify_script])
        sys.exit(0)

    success_count = 0
    error_count = 0

    for idx, img_path in enumerate(images, 1):
        rel_img = os.path.relpath(img_path, ROOT_DIR)
        print(f"[{idx}/{total}] Processing: {rel_img} ... ", end="", flush=True)

        try:
            ok, out_path, result = process_image(
                image_path=img_path,
                api_key=api_key,
                catalog=catalog,
                delay=args.delay,
                force_api=args.force_api,
                dry_run=args.dry_run,
                verbose=args.verbose,
            )
            success_count += 1
            name = result.get("name", "Unknown")
            cat_type = result.get("type", "")
            print(f"OK -> \"{name}\" ({cat_type})")
        except Exception as e:
            error_count += 1
            print(f"FAIL: {e}")

        if idx < total and args.delay > 0:
            time.sleep(args.delay)

    print("\n" + "=" * 60)
    print(f"Processing Complete: {success_count} succeeded, {error_count} failed out of {total} images.")
    print("=" * 60)

    if args.verify:
        print("\nRunning verification suite:")
        verify_script = os.path.join(ROOT_DIR, "tools", "verify_images_ocr.py")
        subprocess.run([sys.executable, verify_script])


if __name__ == "__main__":
    main()
