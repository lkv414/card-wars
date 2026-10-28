# Ветка `ocr-sources`

Ветка для **графики и всего, что связано с исходниками**: сканы карт «Adventure Time: Card Wars», OCR, нарезанные картинки контента. Игрового кода на ветке нет (он живёт в `main`, `v2`, `v3`).

## Что на ветке

| Путь | Что это |
| --- | --- |
| `исходники/Adventure Time Card Wars/` | оригинальные сканы печатных листов по каждому набору (Finn vs Jake, BMO vs Lady Rainicorn, Lemongrab vs Gunter, Ice King vs Marceline, Fiona vs Cake, Bubblegum vs LSP, Король Лич vs Деревяшка, Doubles Tournament, For the Glory), листы героев и земель, cardlist'ы, правила |
| `исходники/карты/` | нарезанные по одной карты (png) + OCR-результат рядом с каждым сканом (json) |
| `исходники/cards.json` | сводный результат OCR — распознаны все 840 карт |
| `content/` | готовый контент для игры: `cards/`, `heroes/`, `lands/` — картинки (`*/images/*.png`) + json-описания (`*/*.json`) + общий `index.json` |
| `tools/split_sheets.py` | нарезка печатных листов земель и героев в отдельные карты контента (координаты сетки, sha256, пишутся json) |
| `docs/journal/` | журнал работы |
| `.ocr-test/`, `.zcode/`, `.idea/` | служебное, не коммитится |

## Формат контента

- Структура: `content/<heroes|lands>/<heroes|lands>/<id>.json` + `content/<heroes|lands>/images/<id>.png`.
- В json: `id`, `name`, `type`, `typeCategory` (`hero` / `land` / `back`), `deckSet` / `landType`, `variant`, `description`, `image`, `sha256` (хэш картинки), `sources` (откуда нарезано).
- `index.json` — плоский список всего контента для игры: `id`, `name`, `kind` (= `typeCategory` из json), `deckSet`, `landType`, `image`.

## Текущее состояние

- Нарезаны земли и герои: 28 земель (по 4 варианта каждого типа + рубашка), 25 героев + рубашка.
- sha256 всех картинок сходятся с указанным в json; полная сверка `index.json` ↔ json ↔ png — 0 проблем (см. `docs/journal/2026-10-28.md`).

## Повторить нарезку

```bash
python tools/split_sheets.py   # нужны python + cv2, numpy, pillow
```

## Правила работы на ветке

- Сюда складывать только исходники/графику/инструменты нарезки; игровой код не тащить.
- Новые сканы класть в `исходники/…`, нарезку обновлять скриптом, чтобы json и sha256 оставались согласованными.
