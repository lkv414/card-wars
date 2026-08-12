"""Shared OCR parse + DB compare helpers for PaddleOCR pipeline."""
from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any

CARD_TYPE_ALIASES = {
    "creature": ("creature", "существо", "существа"),
    "spell": ("spell", "заклинание", "заклинания"),
    "building": ("building", "строение", "строения"),
    "landscape": ("landscape", "land", "земля", "ландшафт", "ландшафты"),
}

LAND_TYPE_ALIASES = {
    "blue": ("blue", "син", "синяя", "синие"),
    "corn": ("corn", "кукуруз", "кукуруза"),
    "good": ("good", "nice", "свет", "светлая", "светлые"),
    "ice": ("ice", "лёд", "лед", "ледя"),
    "sand": ("sand", "desert", "пуст", "пустын"),
    "swamp": ("swamp", "болот"),
    "any": ("any", "rainbow", "радуг", "люб"),
}


def _json_safe(val: Any) -> Any:
    if isinstance(val, dict):
        return {k: _json_safe(v) for k, v in val.items()}
    if isinstance(val, list):
        return [_json_safe(v) for v in val]
    if hasattr(val, "item"):
        try:
            return val.item()
        except Exception:
            pass
    if isinstance(val, (float, int, str, bool)) or val is None:
        return val
    return str(val)


def sanitize_ocr_payload(ocr: dict) -> dict:
    return _json_safe(ocr)


def norm(s: Any) -> str:
    if s is None:
        return ""
    t = str(s).strip().lower()
    t = t.replace("ё", "е")
    return re.sub(r"\s+", " ", t)


def name_similar(a: Any, b: Any, threshold: float = 0.78) -> bool:
    if not a or not b:
        return False
    na, nb = norm(a), norm(b)
    if na == nb or na in nb or nb in na:
        return True
    return SequenceMatcher(None, na, nb).ratio() >= threshold


def text_similar(a: Any, b: Any, threshold: float = 0.72) -> bool:
    if not a and not b:
        return True
    if not a or not b:
        return False
    return SequenceMatcher(None, norm(a), norm(b)).ratio() >= threshold


def _parse_int(val: Any) -> int | None:
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return int(val)
    m = re.search(r"\d+", str(val))
    return int(m.group(0)) if m else None


def _line_items(paddle_result: Any) -> list[dict]:
    """Normalize PaddleOCR output to [{text, conf, cx, cy, x0, y0, x1, y1}]."""
    if not paddle_result:
        return []

    rows = paddle_result[0] if isinstance(paddle_result, list) and paddle_result else paddle_result
    if not rows:
        return []

    items: list[dict] = []
    for row in rows:
        if not row or len(row) < 2:
            continue
        box, rec = row[0], row[1]
        if isinstance(rec, (list, tuple)):
            text, conf = rec[0], float(rec[1] if len(rec) > 1 else 0.0)
        else:
            text, conf = str(rec), 0.0
        text = (text or "").strip()
        if not text:
            continue
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        x0, x1 = min(xs), max(xs)
        y0, y1 = min(ys), max(ys)
        items.append({
            "text": text,
            "conf": conf,
            "cx": (x0 + x1) / 2,
            "cy": (y0 + y1) / 2,
            "x0": x0,
            "y0": y0,
            "x1": x1,
            "y1": y1,
        })
    return items


def convert_paddle_v3_results(results: Any) -> list:
    """PaddleOCR 3.x predict() → legacy [[box, (text, conf)], ...] shape."""
    import json

    legacy_rows: list = []
    for item in results or []:
        data = item
        if hasattr(item, "json"):
            j = item.json
            data = j() if callable(j) else j
        elif hasattr(item, "to_dict"):
            data = item.to_dict()
        elif hasattr(item, "str") and callable(item.str):
            try:
                data = json.loads(item.str())
            except Exception:
                data = None
        if isinstance(data, str):
            data = json.loads(data)
        if not isinstance(data, dict):
            continue
        # PaddleOCR 3.x OCRResult.json() wraps payload in {"res": {...}}
        payload = data.get("res") if isinstance(data.get("res"), dict) else data
        texts = payload.get("rec_texts") or payload.get("rec_text") or []
        if isinstance(texts, str):
            texts = [texts]
        scores = payload.get("rec_scores") or payload.get("rec_score") or []
        if isinstance(scores, (int, float)):
            scores = [scores]
        polys = (
            payload.get("dt_polys")
            or payload.get("rec_polys")
            or payload.get("rec_boxes")
            or []
        )
        for idx, text in enumerate(texts):
            if not text:
                continue
            conf = float(scores[idx]) if idx < len(scores) else 0.0
            poly = polys[idx] if idx < len(polys) else None
            if not poly:
                legacy_rows.append([[[0, 0], [1, 0], [1, 1], [0, 1]], (text, conf)])
            else:
                legacy_rows.append([poly, (text, conf)])
    return [legacy_rows] if legacy_rows else []


def parse_card_from_ocr(paddle_result: Any, img_w: int, img_h: int) -> dict:
    """
    Heuristic parser for Card Wars cut layout.
    Returns structured guess + raw lines for debugging.
    """
    items = _line_items(paddle_result)
    if not items:
        return {
            "name": None,
            "cost": None,
            "attack": None,
            "health": None,
            "description": None,
            "all_text": "",
            "lines": [],
        }

    w = max(img_w, 1)
    h = max(img_h, 1)

    def rel_x(it: dict) -> float:
        return it["cx"] / w

    def rel_y(it: dict) -> float:
        return it["cy"] / h

    def is_number_line(t: str) -> bool:
        return bool(re.fullmatch(r"\d{1,2}", t.strip()))

    top = [it for it in items if rel_y(it) < 0.38]
    bottom = [it for it in items if rel_y(it) > 0.72]
    middle = [it for it in items if 0.32 <= rel_y(it) <= 0.78]

    cost = None
    for it in sorted(top, key=lambda x: (rel_x(x), rel_y(x))):
        if is_number_line(it["text"]) and rel_x(it) < 0.28:
            cost = _parse_int(it["text"])
            break

    attack = None
    health = None
    for it in bottom:
        if not is_number_line(it["text"]):
            continue
        val = _parse_int(it["text"])
        if val is None:
            continue
        if rel_x(it) < 0.42 and attack is None:
            attack = val
        elif rel_x(it) > 0.58 and health is None:
            health = val

    name_candidates = [
        it for it in top
        if not is_number_line(it["text"]) and len(it["text"]) >= 3
    ]
    name = None
    if name_candidates:
        name_candidates.sort(key=lambda x: (-len(x["text"]), x["cy"]))
        name = name_candidates[0]["text"]

    desc_parts = sorted(middle, key=lambda x: (x["cy"], x["cx"]))
    description = " ".join(it["text"] for it in desc_parts if len(it["text"]) > 2) or None

    all_text = " ".join(it["text"] for it in sorted(items, key=lambda x: (x["cy"], x["cx"])))

    return {
        "name": name,
        "cost": cost,
        "attack": attack,
        "health": health,
        "description": description,
        "all_text": all_text,
        "lines": items,
    }


def compare_card_db_ocr(db_row: dict, ocr: dict, *, name_threshold: float = 0.78) -> list[dict]:
    """Return list of {field, db, ocr, severity}."""
    diffs: list[dict] = []

    db_name = db_row.get("name")
    ocr_name = ocr.get("name")
    if ocr_name and db_name and not name_similar(db_name, ocr_name, name_threshold):
        # Also try: is OCR name substring anywhere in full text vs db name wrong entirely
        diffs.append({
            "field": "name",
            "db": db_name,
            "ocr": ocr_name,
            "severity": "error",
        })

    for field in ("cost", "attack", "health"):
        db_val = _parse_int(db_row.get(field))
        ocr_val = _parse_int(ocr.get(field))
        if ocr_val is None:
            continue
        if db_val is None or db_val != ocr_val:
            diffs.append({
                "field": field,
                "db": db_val,
                "ocr": ocr_val,
                "severity": "error" if field == "cost" else "warning",
            })

    db_desc = db_row.get("description")
    ocr_desc = ocr.get("description")
    if db_desc and ocr_desc and not text_similar(db_desc, ocr_desc, 0.65):
        diffs.append({
            "field": "description",
            "db": (db_desc or "")[:120],
            "ocr": (ocr_desc or "")[:120],
            "severity": "warning",
        })

    # Fallback: DB name not found in OCR full text at all
    if db_name and ocr.get("all_text") and not name_similar(db_name, ocr.get("all_text"), 0.55):
        if not any(d["field"] == "name" for d in diffs):
            best_line = max(ocr.get("lines") or [], key=lambda x: len(x.get("text", "")), default=None)
            guess = best_line["text"] if best_line else ocr_name
            if guess and not name_similar(db_name, guess, name_threshold):
                diffs.insert(0, {
                    "field": "name",
                    "db": db_name,
                    "ocr": guess or ocr_name,
                    "severity": "error",
                })

    return diffs
