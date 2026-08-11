"""
Vision-OCR для всех карт в SQLite БД.
- Идёт по всем cards у которых notes НЕ содержит "OCR done"
- Для каждой карты вызывает vision_analyze через Claude (subprocess)
- Записывает результат в SQLite

Запуск: python ocr_vision.py <batch_size=10>
"""
import sqlite3
import os
import sys
import json
import time
import shutil
import subprocess
import tempfile

ROOT = r"C:\Users\<redacted>\Music\Adventure Time Card Wars"
DB_PATH = r"C:\Users\<redacted>\WebstormProjects\card_game\data\cards.db"

BATCH_SIZE = int(sys.argv[1]) if len(sys.argv) > 1 else 10


def get_pending_cards():
    """Возвращает список карт у которых ещё не было OCR."""
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
        SELECT c.id, c.name, c.card_type, c.land_type, c.hero, c.source, a.source_url
        FROM cards c
        JOIN card_art a ON a.card_id = c.id AND a.is_primary = 1
        WHERE (c.notes IS NULL OR c.notes NOT LIKE '%OCR done%')
        ORDER BY c.card_number
    """)
    rows = cur.fetchall()
    conn.close()
    return rows


def vision_ocr_card(card_id, name, image_rel_path):
    """
    Вызывает vision_analyze через subprocess (отдельный Claude API call).
    Возвращает dict с распознанными данными или None при ошибке.
    """
    full_path = os.path.join(ROOT, image_rel_path)
    if not os.path.exists(full_path):
        print(f"  ✗ Файл не найден: {full_path}")
        return None

    # Скопируем в tmp с ASCII-именем (vision не любит кириллицу)
    tmp = tempfile.mkdtemp(prefix="ocr_v_")
    ascii_path = os.path.join(tmp, f"card_{card_id}.png")
    shutil.copy(full_path, ascii_path)

    prompt = """Прочитай эту карту Card Wars ОЧЕНЬ внимательно и верни ТОЛЬКО JSON со следующими полями:

{
  "name": "русское название",
  "card_type": "creature|spell|building|landscape",
  "land_type": "blue|corn|nice|ice|sand|swamp|rainbow|any",
  "cost": число из кружка слева вверху,
  "attack": число слева внизу (0 если строение/заклинание),
  "health": число справа внизу (0 если строение/заклинание),
  "is_rainbow": true/false,
  "has_flip": true/false,
  "flip_description": "текст флипа если есть, иначе null",
  "description": "ПОЛНЫЙ текст способности на русском, дословно, или null",
  "mechanics": []
}

Для механики (если есть способность) - верни массив:
[{"trigger": "passive|flip|on_play|death|start_turn", "effects": [{"type": "...", "amount": N, ...}]}]

Если не уверен в поле - ставь null. Не выдумывай. Верни ТОЛЬКО JSON, без пояснений."""

    # Вызовем vision_analyze через hermes_tools
    from hermes_tools import vision_analyze
    try:
        result = vision_analyze(image_url=ascii_path, question=prompt)
        # result - dict с полем 'text' (или похожим)
        text = result.get("text", "") if isinstance(result, dict) else str(result)
        # Найдём JSON в тексте
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end])
        return None
    except Exception as e:
        print(f"  ✗ vision error: {e}")
        return None


def main():
    pending = get_pending_cards()
    total = len(pending)
    print(f"[start] Всего карт без OCR: {total}")
    print(f"[start] Размер пачки: {BATCH_SIZE}")
    print(f"[start] БД: {DB_PATH}")

    if total == 0:
        print("[done] Все карты уже распознаны")
        return

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    start_time = time.time()
    processed = 0
    errors = 0

    for i, (card_id, name, card_type, land_type, hero, source, img_path) in enumerate(pending, 1):
        elapsed = time.time() - start_time
        rate = i / elapsed if elapsed > 0 else 0
        eta = (total - i) / rate if rate > 0 else 0
        print(f"\n[{i}/{total}] {name} ({elapsed:.0f}s, rate={rate:.2f}/s, ETA={eta:.0f}s)")
        print(f"  hero={hero}, src={source}, land={land_type}")

        ocr = vision_ocr_card(card_id, name, img_path)
        if ocr is None:
            errors += 1
            continue

        # Обновим запись
        mech_json = json.dumps(ocr.get("mechanics") or [], ensure_ascii=False)
        try:
            cur.execute("""
                UPDATE cards SET
                    name=?,
                    card_type=COALESCE(?, card_type),
                    land_type=COALESCE(?, land_type),
                    cost=COALESCE(?, cost),
                    attack=COALESCE(?, attack),
                    health=COALESCE(?, health),
                    is_rainbow=COALESCE(?, is_rainbow),
                    has_flip=COALESCE(?, has_flip),
                    flip_description=?,
                    description=?,
                    mechanics=?,
                    notes='OCR done (vision)'
                WHERE id=?
            """, (
                ocr.get("name") or name,
                ocr.get("card_type"),
                ocr.get("land_type"),
                ocr.get("cost"),
                ocr.get("attack"),
                ocr.get("health"),
                1 if ocr.get("is_rainbow") else (0 if ocr.get("is_rainbow") is False else None),
                1 if ocr.get("has_flip") else (0 if ocr.get("has_flip") is False else None),
                ocr.get("flip_description"),
                ocr.get("description"),
                mech_json,
                card_id,
            ))
            conn.commit()
            processed += 1
            print(f"  ✓ name='{ocr.get('name')}' type={ocr.get('card_type')} cost={ocr.get('cost')}")
        except Exception as e:
            print(f"  ✗ DB error: {e}")
            errors += 1

        # Прогресс
        if i % 10 == 0:
            print(f"\n*** PROGRESS: {i}/{total} done, {errors} errors, {(time.time()-start_time)/60:.1f} min ***\n")

    conn.close()
    print(f"\n[done] {time.time()-start_time:.0f}s, processed={processed}, errors={errors}")


if __name__ == "__main__":
    main()