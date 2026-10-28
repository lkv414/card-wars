"""Нарезка печатных листов земель и героев в отдельные карты контента."""

import hashlib
import json
import os

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(ROOT, 'content')
PREVIEW_DIR = os.path.join(ROOT, '.tmp-view')

MARGIN = 26

# Границы карт на листах (координаты после поворота, пиксели скана).
LAND_GRID_X = (192, 1180, 1302, 2292)
LAND_GRID_Y = (270, 1684, 1818, 3232)
HERO_GRID_X = (200, 1167, 1310, 2277)
HERO_GRID_Y = (357, 1670, 1834, 3147)

LAND_SHEETS = [
    ('blue', 'Голубые равнины'),
    ('corn', 'Кукурузные поля'),
    ('icy', 'Ледяные земли'),
    ('nice', 'Милые земли'),
    ('sandy', 'Песчаные земли'),
    ('swamp', 'Бесполезные болота'),
]

# sheet, col, row, id, name, deck_set, description
HERO_CARDS = [
    ('1', 0, 0, 'hero_lemongrab', 'ЛимошВат', 'lemongrab',
     'В начале своей фазы Сражения, если у тебя 1 или более пустых земель, получи 1 HP. (Не превышая 25.)'),
    ('1', 1, 0, 'hero_monika', 'Монука', 'monika',
     'Раз за свой ход можешь повернуть применённое существо.'),
    ('1', 0, 1, 'hero_jake_2v2', 'Джейк 2х2', 'jake_2v2',
     'Раз за свой ход, когда существо под твоим контролем ранит противника, можешь нанести 1 урон выбранному существу на своих линиях.'),
    ('1', 1, 1, 'hero_marceline', 'Марселин', 'marceline',
     'У твоих существ с уроном 5 и более, +1 АТК.'),
    ('2', 0, 0, 'hero_grand_prix', 'Гран При', 'grand_prix',
     'В свой ход, когда заменяешь существо в первый раз, тяни карту.'),
    ('2', 1, 0, 'hero_ice_king', 'Ледяной Король', 'ice_king',
     'Во время каждого твоего хода, когда существо под твоим контролем в первый раз атакует пустую линию, у него +1 АТК.'),
    ('2', 0, 1, 'hero_fiona', 'Фионна', 'fiona',
     'Когда под твоим контролем только один тип земли, у твоих Радужных существ +1 АТК.'),
    ('2', 1, 1, 'hero_gunter', 'Гантер', 'gunter',
     'Существа под твоим контролем на землях с Ледяными фишками получают +1 АТК.'),
    ('3', 1, 0, 'hero_charlie', 'Чари', 'charlie',
     'Один раз за свой ход можешь переместить существо под твоим контролем на соседнюю пустую линию.'),
    ('3', 1, 1, 'hero_cake', 'Кейк', 'cake',
     'Каждый раз, когда вступает в игру строение под твоим контролем, восстанови 2 HP каждому существу под твоим контролем со строением на этой земле.'),
    ('4', 0, 0, 'hero_ricardio', 'Рикардио', None,
     'В каждый свой ход, один раз можешь потратить 1 HP. Если сделал это, открой верхнюю карту своей колоды. Можешь сбросить её.'),
    ('4', 1, 0, 'hero_tree_trunks', 'Деревяшка', 'tree_trunks',
     'В каждый свой ход, один раз можешь сбросить карту со словом «Пирог» в названии и получить 1 действие.'),
    ('4', 0, 1, 'hero_prismo', 'Призмо', None,
     'Если у тебя нет одинаковых земель, у твоих существ +1 DEF.'),
    ('4', 1, 1, 'hero_strong_susan', 'Сильная Сьюзан', None,
     'Потрать 1 действие и уничтожь существо под твоим контролем >>> Нанеси урон, равный его стоимости, каждому существу противника.'),
    ('5', 0, 0, 'hero_finn', 'Фини', 'finn',
     'Существа под твоим контролем, не получившие урон, получают «ПРИЕМ >>> Нанеси 1 урон выбранному существу».'),
    ('5', 1, 0, 'hero_jake', 'Джейк', 'jake',
     'Существа под твоим контролем, лежащие на повернутых лицом вниз землях, получают +2 АТК.'),
    ('5', 0, 1, 'hero_cosmic_owl', 'Космическая сова', None,
     'Потрать 1 действие >>> Посмотри и измени порядок 4х верхних карт своей колоды.'),
    ('5', 1, 1, 'hero_huntress_wizard', 'Колдунья-охотница', None,
     'В начале игры выбери слово из 3х и более букв. Когда играешь карту с этим словом в названии, нанеси 1 урон выбранному существу под контролем противника.'),
    ('6', 0, 0, 'hero_lsp', 'Принцесса Пупырка', 'lsp',
     'В свой ход, когда заменяешь существо в первый раз, тяни карту.'),
    ('6', 1, 0, 'hero_bubblegum', 'Принцесса Жвачка', 'bubblegum',
     'Один раз за ход можешь нанести 1 урон своему существу. Это существо получает +1 АТК в этом ходу.'),
    ('6', 0, 1, 'hero_lady_rainicorn', 'Леди Ливнерог', 'lady_rainicorn',
     'Если во время своего хода ты возвращаешь себе на руку 2 или более существ из игры или из своего сброса, ты восстанавливаешь 2 HP.'),
    ('6', 1, 1, 'hero_magic_man', 'Волшебный чел', None,
     'Когда играешь карту стоимостью ровно 2, нанеси 2 урона существу под контролем противника.'),
    ('7', 0, 0, 'hero_abracadaniel', 'Абракаданиэль', None,
     'Потрать 1 действие >>> Посмотри верхнюю карту своей колоды. Если это Радужная карта, сыграй её.'),
    ('7', 1, 0, 'hero_bmo', 'БиМО', 'bmo',
     'Сбрось карту с руки >>> Нанеси 1 урон выбранному существу.'),
    ('7', 1, 1, 'hero_billy', 'Билли', None,
     'Если колода твоего противника закончилась, ты победил.'),
]

# Листы 5 и 7 уже в портретной ориентации, остальные напечатаны боком.
UPRIGHT_HERO_SHEETS = {'5', '7'}


def find_source_root():
    for parent in os.listdir(ROOT):
        parent_path = os.path.join(ROOT, parent)
        if not os.path.isdir(parent_path):
            continue
        for name in os.listdir(parent_path):
            path = os.path.join(parent_path, name)
            if os.path.isdir(path) and 'Adventure Time Card Wars' in name:
                return path
    raise SystemExit('Не найдена папка "Adventure Time Card Wars" с исходниками')


SRC = find_source_root()
LANDS_DIR = os.path.join(SRC, 'All_Lands')
HEROES_DIR = os.path.join(SRC, 'all_heroes')


def imread(path):
    data = np.fromfile(path, dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
        raise SystemExit(f'Не читается изображение: {path}')
    return image


def write_png(image, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    Image.fromarray(rgb).save(path, optimize=True)
    return path


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(',', ':'))


def cell_box(grid_x, grid_y, col, row, margin=MARGIN):
    x1, x2 = grid_x[col * 2], grid_x[col * 2 + 1]
    y1, y2 = grid_y[row * 2], grid_y[row * 2 + 1]
    return x1 - margin, y1 - margin, x2 + margin, y2 + margin


def crop_cell(image, grid_x, grid_y, col, row, margin=MARGIN):
    x1, y1, x2, y2 = cell_box(grid_x, grid_y, col, row, margin)
    return image[y1:y2, x1:x2].copy()


def load_land_sheet(sheet):
    image = imread(os.path.join(LANDS_DIR, sheet + '.png'))
    return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)


def load_hero_sheet(sheet):
    image = imread(os.path.join(HEROES_DIR, sheet + '.png'))
    if sheet not in UPRIGHT_HERO_SHEETS:
        image = cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    return image


def build_lands():
    entries = []
    cards = []
    for sheet, name in LAND_SHEETS:
        image = load_land_sheet(sheet)
        for variant in range(1, 5):
            col, row = (variant - 1) % 2, (variant - 1) // 2
            card_id = f'land_{sheet}_{variant}'
            image_path = os.path.join(CONTENT, 'lands', 'images', card_id + '.png')
            write_png(crop_cell(image, LAND_GRID_X, LAND_GRID_Y, col, row), image_path)
            record = {
                'id': card_id,
                'name': name,
                'type': 'Земля',
                'typeCategory': 'land',
                'landType': sheet,
                'variant': variant,
                'description': '',
                'image': f'/content/lands/images/{card_id}.png',
                'sha256': sha256(image_path),
                'sources': [f'All_Lands/{sheet}.png#{variant}'],
            }
            write_json(os.path.join(CONTENT, 'lands', 'lands', card_id + '.json'), record)
            cards.append(record)
            entries.append({
                'id': card_id,
                'name': name,
                'landType': sheet,
                'image': record['image'],
                'kind': 'land',
            })

    for variant in range(1, 5):
        card_id = f'land_ghost_{variant}'
        source = os.path.join(LANDS_DIR, f'{variant}.png')
        image_path = os.path.join(CONTENT, 'lands', 'images', card_id + '.png')
        write_png(imread(source), image_path)
        record = {
            'id': card_id,
            'name': 'Призрачные земли',
            'type': 'Земля',
            'typeCategory': 'land',
            'landType': 'ghost',
            'variant': variant,
            'description': '',
            'image': f'/content/lands/images/{card_id}.png',
            'sha256': sha256(image_path),
            'sources': [f'All_Lands/{variant}.png'],
        }
        write_json(os.path.join(CONTENT, 'lands', 'lands', card_id + '.json'), record)
        cards.append(record)
        entries.append({
            'id': card_id,
            'name': 'Призрачные земли',
            'landType': 'ghost',
            'image': record['image'],
            'kind': 'land',
        })

    card_id = 'land_back'
    image_path = os.path.join(CONTENT, 'lands', 'images', card_id + '.png')
    write_png(imread(os.path.join(LANDS_DIR, 'рубашка.png')), image_path)
    record = {
        'id': card_id,
        'name': 'Рубашка земель',
        'type': 'Рубашка',
        'typeCategory': 'back',
        'image': f'/content/lands/images/{card_id}.png',
        'sha256': sha256(image_path),
        'sources': ['All_Lands/рубашка.png'],
    }
    write_json(os.path.join(CONTENT, 'lands', 'lands', card_id + '.json'), record)
    entries.append({
        'id': card_id,
        'name': record['name'],
        'image': record['image'],
        'kind': 'back',
    })
    return cards, entries


def build_heroes():
    entries = []
    cards = []
    sheets = {}
    for sheet, col, row, card_id, name, deck_set, description in HERO_CARDS:
        if sheet not in sheets:
            sheets[sheet] = load_hero_sheet(sheet)
        image_path = os.path.join(CONTENT, 'heroes', 'images', card_id + '.png')
        write_png(crop_cell(sheets[sheet], HERO_GRID_X, HERO_GRID_Y, col, row), image_path)
        record = {
            'id': card_id,
            'name': name,
            'type': 'Герой',
            'typeCategory': 'hero',
        }
        if deck_set:
            record['deckSet'] = deck_set
        record.update({
            'description': description,
            'image': f'/content/heroes/images/{card_id}.png',
            'sha256': sha256(image_path),
            'sources': [f'all_heroes/{sheet}.png#c{col}r{row}'],
        })
        write_json(os.path.join(CONTENT, 'heroes', 'heroes', card_id + '.json'), record)
        cards.append(record)
        entry = {'id': card_id, 'name': name}
        if deck_set:
            entry['deckSet'] = deck_set
        entry.update({'image': record['image'], 'kind': 'hero'})
        entries.append(entry)

    back_sheet = cv2.rotate(imread(os.path.join(HEROES_DIR, 'оборот.png')), cv2.ROTATE_90_CLOCKWISE)
    card_id = 'hero_back'
    image_path = os.path.join(CONTENT, 'heroes', 'images', card_id + '.png')
    write_png(crop_cell(back_sheet, HERO_GRID_X, HERO_GRID_Y, 0, 0), image_path)
    record = {
        'id': card_id,
        'name': 'Рубашка героев',
        'type': 'Рубашка',
        'typeCategory': 'back',
        'image': f'/content/heroes/images/{card_id}.png',
        'sha256': sha256(image_path),
        'sources': ['all_heroes/оборот.png#c0r0'],
    }
    write_json(os.path.join(CONTENT, 'heroes', 'heroes', card_id + '.json'), record)
    entries.append({
        'id': card_id,
        'name': record['name'],
        'image': record['image'],
        'kind': 'back',
    })
    return cards, entries


def update_index(new_entries):
    index_path = os.path.join(CONTENT, 'index.json')
    with open(index_path, encoding='utf-8') as handle:
        index = json.load(handle)
    new_ids = {entry['id'] for entry in new_entries}
    index = [entry for entry in index if entry.get('id') not in new_ids]
    index.extend(new_entries)
    with open(index_path, 'w', encoding='utf-8') as handle:
        json.dump(index, handle, ensure_ascii=False, separators=(',', ':'))
    return index


def preview(cards, folder, name, columns, width):
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    tiles = []
    for card in cards:
        image = imread(os.path.join(ROOT, card['image'].lstrip('/')))
        height = int(width * image.shape[0] / image.shape[1])
        tiles.append(cv2.resize(image, (width, height)))
    tile_h = max(tile.shape[0] for tile in tiles)
    rows = (len(tiles) + columns - 1) // columns
    canvas = np.full((rows * (tile_h + 30) + 10, columns * (width + 10) + 10, 3), 245, np.uint8)
    for i, (tile, card) in enumerate(zip(tiles, cards)):
        row, col = divmod(i, columns)
        y, x = 10 + row * (tile_h + 30) + 24, 10 + col * (width + 10)
        canvas[y:y + tile.shape[0], x:x + tile.shape[1]] = tile
        cv2.putText(canvas, card['id'].encode('ascii', 'replace').decode(), (x, y - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 1)
    cv2.imwrite(os.path.join(PREVIEW_DIR, folder + '_' + name + '.jpg'), canvas)


def main():
    land_cards, land_entries = build_lands()
    hero_cards, hero_entries = build_heroes()
    index = update_index(land_entries + hero_entries)
    preview(land_cards, 'lands', 'preview', 6, 240)
    preview(hero_cards, 'heroes', 'preview', 5, 260)
    print(f'lands: {len(land_cards)} cards, heroes: {len(hero_cards)} cards')
    print(f'index entries: {len(index)}')


if __name__ == '__main__':
    main()
