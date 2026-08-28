"""
parse_mechanics.py — структурированный парсер механик AT Card Wars (v3).

Дизайн:
  Каждая механика — это:
    {
      "trigger": "<когда срабатывает>",
      "actions": [<действия, выполняемые при срабатывании>]
      "conditions": [<опциональные условия через AND/OR>],
      "description": "<человекочитаемый текст для UI>"
    }

Триггеры (when fires):
  manual           — ПРИЕМ / императив
  on_play          — когда вступает в игру
  on_enters_play   — то же
  on_flip          — флоп
  start_of_turn    — в начале своего хода
  start_of_next_turn
  end_of_turn      — в конце своего хода
  on_attack        — когда атакует
  on_damage_dealt  — когда наносит урон
  on_damage_taken  — когда получает урон
  on_death         — когда умирает
  on_discard       — когда сбрасывается
  on_line_change   — когда меняет линию
  on_draw          — когда тянешь
  persistent       — пассивно (аура)
  conditional      — по условию (вместе с conditions[])

Действия (Action-классы, ООП):

  class Damage(amount, target, filter=None)
    «нанеси N урона X»
    Примеры: amount 1..5, target в target-таблице
    Параметры:
      amount     — int (1..10)
      target     — string (см. TARGETS)
      filter     — string (null|"opponent_with_no_hand"|"for_each_x_in_discard"|...)
      pierce     — bool (идёт через защиту)

  class Heal(amount, target, cap=25)
    «восстанови N HP»

  class Draw(count=1, source="deck", filter=None)
    «тяни N карт»

  class Discard(count=1, source="hand", random_=False)
    «сбрось N карт»

  class Destroy(target)
    «уничтожь X»

  class Move(target, destination, return_after_battle=False)
    «перемести X на Y»

  class ReturnFromDiscard(target="creature", cost_filter=None, destination="hand")
    «верни X из стопки сброса»

  class Summon(source="deck", name=None, into_lane=None)
    «призови X»

  class FlipLandscape(target, face="down")
    «переверни X вверх/вниз»

  class FreezeLandscape(target)
    «заморозь X»

  class GainActions(count)
    «получи N действий в этот ход»

  class StatBuff(stat, amount, target, duration="persistent"|"this_turn")
    «+N ATK/DEF/HP X»

  class Search(source="deck", count=1, filter=None, into="hand")
    «найди N карт»

  class Prevent(event, target=None)
    «предотврати X»

  class ConditionalBonus(condition_stat, threshold, bonus_action)
    «если HP<10, +2 ATK»

Цели (targets):

  chosen_opponent_creature   — выбранное существо противника
  chosen_opponent            — выбранный противник
  chosen_creature            — выбранное существо (любое)
  chosen_creature_any        — любое выбранное (карта/существо/здание)
  chosen_landscape           — выбранная земля
  chosen_discard             — выбранная карта из стопки сброса
  each_creature              — каждое существо (или своё/противника)
  each_creature_yours        — каждое своё существо
  each_creature_opponent     — каждое существо противника
  each_opponent              — каждый противник (face damage)
  each_creature_in_lane      — каждое существо в этой линии
  each_creature_adjacent     — каждое соседнее существо
  each_creature_landscape    — каждое существо на этой земле
  each_creature_no_hand      — каждый противник без карт в руке (face damage)
  this_creature              — эта карта
  adjacent_creature          — соседнее существо
  this_lane                  — эта полоса
  opponent_lane              — полоса противника
  this_landscape             — эта земля
  this_landscape_pair        — обе земли на этой линии
  landscape_type_X          — конкретный тип земли (corn, swamp, plains, sand, ...)
  self                       — сам герой
  deck                       — колода
  hand                       — рука
  discard_pile               — стопка сброса
  trigger_creature           — существо, на котором сработал триггер
  none                       — без явной цели (например gain_actions)

Выход: cards.with_mechanics.json
"""

import json
import re
import sys
from pathlib import Path

SRC = Path(r"исходники/cards.dedup_by_name.json")
DST = Path(r"исходники/cards.with_mechanics.json")


# ───────── TARGETS (цели) ─────────

class Target:
    """Цель действия — может быть разной на разных уровнях."""
    CHOSEN_OPPONENT_CREATURE = "chosen_opponent_creature"
    CHOSEN_OPPONENT = "chosen_opponent"
    CHOSEN_CREATURE = "chosen_creature"
    CHOSEN_CREATURE_ANY = "chosen_creature_any"
    CHOSEN_LANDSCAPE = "chosen_landscape"
    CHOSEN_DISCARD = "chosen_discard"
    EACH_CREATURE = "each_creature"
    EACH_CREATURE_YOURS = "each_creature_yours"
    EACH_CREATURE_OPPONENT = "each_creature_opponent"
    EACH_OPPONENT = "each_opponent"
    EACH_CREATURE_IN_LANE = "each_creature_in_lane"
    EACH_CREATURE_ADJACENT = "each_creature_adjacent"
    EACH_CREATURE_LANDSCAPE = "each_creature_landscape"
    EACH_CREATURE_NO_HAND = "each_creature_no_hand"
    THIS_CREATURE = "this_creature"
    ADJACENT_CREATURE = "adjacent_creature"
    THIS_LANE = "this_lane"
    OPPONENT_LANE = "opponent_lane"
    THIS_LANDSCAPE = "this_landscape"
    THIS_LANDSCAPE_PAIR = "this_landscape_pair"
    TRIGGER_CREATURE = "trigger_creature"
    SELF = "self"
    DECK = "deck"
    HAND = "hand"
    DISCARD_PILE = "discard_pile"
    NONE = "none"


# ───────── БАЗОВЫЙ КЛАСС ─────────

class Action:
    """Базовое действие механики. Все действия имеют type + target + fields."""
    type = "action"

    def __init__(self, target=None, filter=None, source_text=""):
        self.target = target or Target.NONE
        self.filter = filter or ""
        self.source_text = source_text

    def to_dict(self):
        d = {"type": self.type, "target": self.target}
        if self.filter:
            d["filter"] = self.filter
        # Сохраняем все именованные параметры
        for k, v in self.params.items():
            d[k] = v
        return d

    @property
    def params(self) -> dict:
        return {}


class Damage(Action):
    type = "deal_damage"

    def __init__(self, amount, target=Target.CHOSEN_OPPONENT_CREATURE, pierce=False, **kw):
        super().__init__(**kw)
        self.amount = amount
        self.target = target
        self.pierce = pierce

    @property
    def params(self):
        return {"amount": self.amount, "pierce": self.pierce}


class Heal(Action):
    type = "heal"

    def __init__(self, amount, target=Target.SELF, cap=25, **kw):
        super().__init__(**kw)
        self.amount = amount
        self.target = target
        self.cap = cap

    @property
    def params(self):
        return {"amount": self.amount, "cap": self.cap}


class Draw(Action):
    type = "draw_cards"

    def __init__(self, count=1, source="deck", filter="", **kw):
        super().__init__(target=Target.NONE, **kw)
        self.count = count
        self.source = source
        self.filter = filter

    @property
    def params(self):
        d = {"count": self.count, "source": self.source}
        if self.filter:
            d["filter"] = self.filter
        return d


class Discard(Action):
    type = "discard_cards"

    def __init__(self, count=1, source="hand", random=False, **kw):
        super().__init__(target=Target.NONE, **kw)
        self.count = count
        self.source = source
        self.random = random

    @property
    def params(self):
        return {"count": self.count, "source": self.source, "random": self.random}


class Destroy(Action):
    type = "destroy"

    def __init__(self, target=Target.CHOSEN_OPPONENT_CREATURE, count=1, **kw):
        super().__init__(target=target, **kw)
        self.count = count

    @property
    def params(self):
        return {"count": self.count}


class Move(Action):
    type = "move"

    def __init__(self, target=Target.CHOSEN_CREATURE, destination=Target.THIS_LANE,
                 return_after_battle=False, **kw):
        super().__init__(target=target, **kw)
        self.destination = destination
        self.return_after_battle = return_after_battle

    @property
    def params(self):
        d = {"destination": self.destination}
        if self.return_after_battle:
            d["return_after_battle"] = self.return_after_battle
        return d


class ReturnFromDiscard(Action):
    type = "return_from_discard"

    def __init__(self, target=Target.CHOSEN_DISCARD, cost_filter=None,
                 destination=Target.HAND, **kw):
        super().__init__(target=target, **kw)
        self.cost_filter = cost_filter
        self.destination = destination

    @property
    def params(self):
        d = {"destination": self.destination}
        if self.cost_filter is not None:
            d["cost_filter"] = self.cost_filter
        return d


class FlipLandscape(Action):
    type = "flip_landscape"

    def __init__(self, target=Target.CHOSEN_LANDSCAPE, face="down", **kw):
        super().__init__(target=target, **kw)
        self.face = face

    @property
    def params(self):
        return {"face": self.face}


class FreezeLandscape(Action):
    type = "freeze_landscape"

    def __init__(self, target=Target.CHOSEN_LANDSCAPE, **kw):
        super().__init__(target=target, **kw)


class GainActions(Action):
    type = "gain_actions"

    def __init__(self, count=1, **kw):
        super().__init__(target=Target.NONE, **kw)
        self.count = count

    @property
    def params(self):
        return {"count": self.count}


class StatBuff(Action):
    """+N ATK/DEF/HP существу или многим."""
    type = "stat_buff"

    def __init__(self, stat, amount, target=Target.EACH_CREATURE_YOURS,
                 duration="persistent", **kw):
        super().__init__(target=target, **kw)
        self.stat = stat
        self.amount = amount
        self.duration = duration

    @property
    def params(self):
        return {"stat": self.stat, "amount": self.amount, "duration": self.duration}


class AoeDamage(Action):
    """Урон нескольким: «каждому противнику без карт в руке» — Damage с особым фильтром."""
    type = "aoe_damage"

    def __init__(self, amount, target_filter, **kw):
        super().__init__(target=Target.NONE, filter=target_filter, **kw)
        self.amount = amount

    @property
    def params(self):
        return {"amount": self.amount}


class ConditionalBonus(Action):
    """Бонус по условию — обёртка над action при выполнении condition."""
    type = "conditional_bonus"

    def __init__(self, condition_stat, threshold, op="lt", bonus_action=None, **kw):
        super().__init__(target=Target.NONE, **kw)
        self.condition_stat = condition_stat
        self.threshold = threshold
        self.op = op
        self.bonus_action = bonus_action

    @property
    def params(self):
        return {
            "condition_stat": self.condition_stat,
            "threshold": self.threshold,
            "op": self.op,
            "bonus_action": self.bonus_action.to_dict() if self.bonus_action else None,
        }


class Search(Action):
    """Поиск карты в колоде."""
    type = "search"

    def __init__(self, source="deck", count=1, filter="creature",
                 destination=Target.HAND, **kw):
        super().__init__(target=Target.HAND, **kw)
        self.source = source
        self.count = count
        self.filter = filter
        self.destination = destination

    @property
    def params(self):
        return {"source": self.source, "count": self.count,
                "filter": self.filter, "destination": self.destination}


class Prevent(Action):
    type = "prevent"

    def __init__(self, event, target=Target.NONE, **kw):
        super().__init__(target=target, **kw)
        self.event = event

    @property
    def params(self):
        return {"event": self.event}


# ───────── ТРИГГЕРЫ ─────────

TRIGGER_NAMES = {
    "manual": "manual",
    "on_play": "on_enters_play",
    "on_enters_play": "on_enters_play",
    "on_flip": "on_flip",
    "start_of_turn": "start_of_turn",
    "start_of_next_turn": "start_of_next_turn",
    "end_of_turn": "end_of_turn",
    "on_attack": "on_creature_attacks",
    "on_creature_attacks": "on_creature_attacks",
    "on_damage_dealt": "on_damage_dealt",
    "on_damage_taken": "on_damage_taken",
    "on_death": "on_death",
    "on_discard": "on_discard",
    "on_line_change": "on_line_change",
    "on_draw": "on_draw",
    "persistent": "persistent",
    "conditional": "conditional",
}


def normalize_trigger(s: str) -> str:
    return TRIGGER_NAMES.get(s.lower().strip(), "manual")


# ───────── ПАРСЕР ─────────

RE_FLOOP = re.compile(r"FLOOP\s*>>>\s*([^.\n]+(?:\.[^.\n]+)*?)(?=\s*[А-ЯA-Z][а-яa-z]|\s*$|\.\s+[А-ЯA-Z])", re.IGNORECASE | re.UNICODE)
RE_COST_ACCEPT = re.compile(r"Потрать\s+(\d+)\s+(?:Действие|Действий|Действия)\s*,?\s*ПРИЕМ\s*>>>\s*([^.\n]+(?:\.[^.\n]+)*?)(?=\s*[А-ЯA-Z][а-яa-z]|\s*$|\.\s+[А-ЯA-Z])", re.IGNORECASE | re.UNICODE)
RE_COND_ACCEPT = re.compile(r"^([^,\n]{5,120}),\s*ПРИЕМ\s*>>>\s*([^.\n]+(?:\.[^.\n]+)*?)(?=\s*[А-ЯA-Z][а-яa-z]|\s*$|\.\s+[А-ЯA-Z])", re.IGNORECASE | re.UNICODE | re.MULTILINE)
RE_ACCEPT = re.compile(r"ПРИЕМ\s*>>>\s*([^.\n]+(?:\.[^.\n]+)*?)(?=\s*[А-ЯA-Z][а-яa-z]|\s*$|\.\s+[А-ЯA-Z])", re.IGNORECASE | re.UNICODE)
RE_ON_ENTERS = re.compile(r"Когда\s+[А-Яа-яЁё][^,.\n]{0,80}?(?:вступает\s+в\s+игру|входит\s+в\s+игру|играется)\s*,?\s*([^.\n]+(?:\.[^.\n]+)*?)(?=\.\s+[А-ЯA-Z]|\.\s*$|$)", re.IGNORECASE | re.UNICODE)
RE_ON_ATTACK = re.compile(r"Когда\s+[А-Яа-яЁё][^,.\n]{0,80}?атакует\s*([^.\n]+(?:\.[^.\n]+)*?)(?=\.\s+[А-ЯA-Z]|\.\s*$|$)", re.IGNORECASE | re.UNICODE)

PASSIVE_TRIGGERS = [
    ("start_of_turn",       ["в начале своего хода", "в начале твоего хода"]),
    ("start_of_next_turn",  ["в начале следующего хода", "в начале следующего своего хода"]),
    ("end_of_turn",         ["в конце своего хода", "в конце твоего хода"]),
    ("on_death",            ["когда это существо умирает", "когда умирает"]),
    ("on_discard",          ["когда сбрасывается"]),
    ("on_damage_dealt",     ["когда наносит урон", "когда наносится урон"]),
    ("on_damage_taken",     ["когда получает урон"]),
    ("on_blocked",          ["когда блокирует"]),
    ("on_line_change",      ["когда меняет линию"]),
    ("on_draw",             ["когда тянет карту", "когда ты тянешь"]),
]

RE_IF = re.compile(r"Если\s+([^,\.\n]{3,200}?),\s*(?:то\s+)?([^.\n]+(?:\.[^.\n]+)*?)(?=\.\s+[А-ЯA-Z]|\.\s*$|$)", re.IGNORECASE | re.UNICODE)

RE_AURA_ATK = re.compile(r"Кажд(?:ое|ый)\s+(?:тво[её]|соседн[еи]е)?\s*[А-Яа-яёЁ]*(?:существ[оы]?|противника)?\s*(?:на\s+[А-Яа-яёЁ]+\s+земле)?\s*(?:без\s+\w+\s+на\s+н[её]м)?\s*получает\s+\+(\d+)\s*(АТК|ATK)", re.IGNORECASE | re.UNICODE)
RE_AURA_DEF = re.compile(r"Кажд(?:ое|ый)\s+(?:тво[её]|соседн[еи]е)?\s*[А-Яа-яёЁ]*(?:существ[оы]?|противника)?\s*(?:на\s+[А-Яа-яёЁ]+\s+земле)?\s*(?:без\s+\w+\s+на\s+н[её]м)?\s*получает\s+\+(\d+)\s*(DEF|HP|защит|здоров)", re.IGNORECASE | re.UNICODE)
RE_AURA_HP = re.compile(r"Кажд(?:ое|ый)\s+[А-Яа-яёЁ][^.\n]{0,80}?(?:восстанавливает|лечит)\s+(\d+)\s*(?:HP|здоров)", re.IGNORECASE | re.UNICODE)
RE_MOD = re.compile(r"(?:получает\s+)?\+(\d+)\s*(АТК|ATK|DEF|HP|атака|защит|здоров)\s+в\s+этом\s+ходу", re.IGNORECASE | re.UNICODE)
RE_WHILE = re.compile(r"Пока\s+([^,.\n]{3,120}?),\s*([^.\n]+(?:\.[^.\n]+)*?)(?=\.\s+[А-ЯA-Z]|\.\s*$|$)", re.IGNORECASE | re.UNICODE)
IMPERATIVE = re.compile(r"^(Уничтожь|Верни|Восстанови|Навеси|Переверни|Выбери|Открой|Перемести|Положи|Призови|Предотврати|Игнорируй|Разрушь|Забери|Перемешай|Сбрось|Получи|Прикажи|Разыграй|Удвой|Утрой|Вылечи|Набери|Сыграй|Напади|Защити|Блокируй|Разблокируй|Подготовь)\s+([^.\n]+(?:\.[^.\n]+)*?)(?=\.\s+[А-ЯA-Z]|\.\s*$|$)", re.IGNORECASE | re.UNICODE | re.MULTILINE)


# ───────── HELPER: разрешение цели из текста ─────────

def resolve_target(text: str) -> str:
    """Анализирует фразу и возвращает имя цели из списка Target."""
    t = text.lower()
    if "кажд" in t and "противник" in t and "без карт" in t:
        return Target.EACH_CREATURE_NO_HAND
    if "кажд" in t and "противник" in t:
        return Target.EACH_CREATURE_OPPONENT
    if "кажд" in t and "тво[её]" in t:
        return Target.EACH_CREATURE_YOURS
    if "кажд" in t and ("соседн" in t or "на той же земле" in t):
        return Target.EACH_CREATURE_ADJACENT
    if "кажд" in t and "лини" in t:
        return Target.EACH_CREATURE_IN_LANE
    if "кажд" in t and "земле" in t:
        return Target.EACH_CREATURE_LANDSCAPE
    if "кажд" in t:
        return Target.EACH_CREATURE
    if "соседн" in t:
        return Target.ADJACENT_CREATURE
    if "выбранн" in t and "противник" in t and "лини" in t:
        return Target.CHOSEN_OPPONENT_CREATURE
    if "выбранн" in t and "противник" in t:
        return Target.CHOSEN_OPPONENT
    if "выбранн" in t and "существ" in t:
        return Target.CHOSEN_CREATURE
    if "выбранн" in t and "земл" in t:
        return Target.CHOSEN_LANDSCAPE
    if "выбранн" in t and "стопк" in t:
        return Target.CHOSEN_DISCARD
    if "земл" in t and ("лицом" in t or "переверни" in t):
        return Target.CHOOSEN_LANDSCAPE if False else Target.CHOSEN_LANDSCAPE
    if "эт" in t and "существ" in t:  # «это существо» → self
        return Target.THIS_CREATURE
    if "колод" in t and "верх" in t:
        return Target.DECK
    if "сброс" in t:
        return Target.DISCARD_PILE
    if "лини" in t:
        return Target.THIS_LANE
    return Target.NONE


# ───────── ОСНОВНОЙ ПАРСЕР: actions[] из effect-строки ─────────

def parse_actions_from_text(effect_text: str, base_target: str = None) -> list:
    """Извлекает массив Action[] из свободного текста эффекта.

    Используется для парсинга:
      • effect от activated/imperative механик
      • «нанеси 1 урон ...», «восстанови 2 HP», «+2 ATK этому ...»
      • «переверни землю», «уничтожь существо», «тяни карту»
    """
    actions = []
    eff = effect_text.strip()
    if not eff:
        return actions

    eff_low = eff.lower()

    # ─── Damage: «нанеси N урона|урона ...» ───
    m = re.search(r"нанес[иы]?\s+(\d+)\s*урона?", eff_low)
    if m:
        amount = int(m.group(1))
        # Извлекаем target из остатка текста
        rest = eff_low[m.end():].strip(" .,;:")
        target = resolve_target(rest) or base_target or Target.CHOSEN_OPPONENT_CREATURE
        actions.append(Damage(amount=amount, target=target, source_text=m.group(0)))
        return actions  # уже распознали

    # ─── «наносит N урона непосредственно противнику» (pierce) ───
    if not actions:
        m = re.search(r"нанос(?:ит|ят)\s+(\d+)\s*урона?\s+непосредственно\s+противнику", eff_low)
        if m:
            actions.append(Damage(
                amount=int(m.group(1)),
                target=Target.CHOSEN_OPPONENT,
                pierce=True,
                source_text=m.group(0)
            ))
            return actions

    # ─── Damage: «наносит N урон» (с подлежащим вместо глагола) ───
    if not actions:
        m = re.search(r"нанос(?:ит|ят)\s+(\d+)\s*урона?", eff_low)
        if m:
            amount = int(m.group(1))
            rest = eff_low[m.end():].strip(" .,;:")
            target = resolve_target(rest) or base_target or Target.CHOSEN_OPPONENT_CREATURE
            actions.append(Damage(amount=amount, target=target, source_text=m.group(0)))
            return actions

    # ─── «сбрось его» ───
    if not actions:
        if "сбрось" in eff_low and ("его" in eff_low or "её" in eff_low or "ее" in eff_low):
            actions.append(Discard(count=1, source="hand", source_text=eff[:80]))
            return actions

    # ─── «можешь положить в свою руку» ───
    if not actions:
        if ("можешь" in eff_low or "может" in eff_low) and "полож" in eff_low and "руку" in eff_low:
            actions.append(Draw(count=1, source="discard_pile", filter="any", source_text=eff[:80]))
            return actions

    # ─── «можешь положить его на верх своей колоды» ───
    if not actions:
        if ("можешь" in eff_low) and "верх" in eff_low and "колод" in eff_low:
            actions.append(Draw(count=1, source="discard_pile", filter="any", source_text=eff[:80]))
            return actions

    # ─── «посмотри верхнюю карту своей колоды» ───
    if not actions:
        if "посмотр" in eff_low and "верхн" in eff_low and "колод" in eff_low:
            actions.append({"type": "peek", "count": 1, "source": "deck", "source_text": eff[:80]})
            return actions

    # ─── «открывай карты» (mill, в классике) ───
    if not actions:
        if "открывай" in eff_low and "колод" in eff_low:
            actions.append({"type": "mill", "count": 1, "source": "deck", "source_text": eff[:80]})
            return actions

    # ─── «на {N} урона» ───
    if not actions:
        m = re.search(r"на\s+(\d+)\s+урона?\s+(\w*)", eff_low)
        if m and "получ" in eff_low:
            actions.append(Damage(amount=int(m.group(1)), target=Target.CHOSEN_OPPONENT, source_text=m.group(0)))
            return actions

    # ─── «на {N} HP» ───
    if not actions:
        m = re.search(r"на\s+(\d+)\s*(?:HP|здоров)", eff_low)
        if m and "получ" in eff_low and "получа" in eff_low:
            actions.append(Heal(amount=int(m.group(1)), target=Target.SELF, source_text=m.group(0)))
            return actions

    # ─── «меняет местами 2 существ» / «поменять местами» ───
    if not actions:
        if "меня" in eff_low and "местами" in eff_low and "существ" in eff_low:
            who = Target.EACH_CREATURE if "выбранн" in eff_low or "люб" in eff_low else Target.CHOSEN_CREATURE
            actions.append(Move(target=who, destination=Target.THIS_LANE, source_text=eff[:80]))
            return actions

    # ─── «можешь нанести 3 Урона выбранному ... существу» ───
    if not actions:
        m = re.search(r"нанес[иы]?\s+(\d+)\s*[Уу]рона?", eff_low)
        if m:
            amount = int(m.group(1))
            target = resolve_target(eff_low) or Target.CHOSEN_OPPONENT_CREATURE
            actions.append(Damage(amount=amount, target=target, source_text=m.group(0)))
            return actions

    # ─── «восстанови 1 урон с существа» ───
    if not actions:
        m = re.search(r"восстанови\s+(\d+)", eff_low)
        if m:
            amount = int(m.group(1))
            target = Target.ADJACENT_CREATURE if "соседн" in eff_low else Target.EACH_CREATURE_YOURS
            cap_m = re.search(r"но не более\s+(\d+)", eff_low)
            cap = int(cap_m.group(1)) if cap_m else 25
            actions.append(Heal(amount=amount, target=target, cap=cap, source_text=m.group(0)))
            return actions

    # ─── «каждое существо получает +N в этом ход» — AOE временный бафф ───
    if not actions:
        m = re.search(r"каждое\s+существо\s+получает\s+\+(\d+)\s*(?:в\s+этом\s+ход|в\s+этот\s+ход)", eff_low)
        if m:
            amount = int(m.group(1))
            actions.append(StatBuff(
                stat="attack",  # не всегда — но в этом шаблоне всегда
                amount=amount,
                target=Target.EACH_CREATURE_YOURS,
                duration="this_turn",
                source_text=m.group(0),
            ))
            return actions

    # ─── «Атаку непосредственно противнику» — face attack ───
    if not actions:
        if "непосредственно противник" in eff_low and "урон" in eff_low:
            actions.append({"type": "face_attack", "source_text": eff[:80]})
            return actions

    # ─── «игнорирует первые N урона» (negate damage) ───
    if not actions:
        m = re.search(r"игнориру(?:ет|ют)\s+(?:первые\s+)?(\d+)\s*урона", eff_low)
        if m:
            actions.append({"type": "ignore_damage", "amount": int(m.group(1)),
                            "source": "on_self", "source_text": eff[:80]})
            return actions

    # ─── «на {N} меньше при стоимости» (cost reduction) ───
    if not actions:
        m = re.search(r"на\s+(\d+)\s+меньше", eff_low)
        if m and ("стоимост" in eff_low or "стои" in eff_low):
            actions.append({"type": "cost_reduction", "amount": int(m.group(1)),
                            "target": "self", "source_text": eff[:80]})
            return actions
        if m and "чтобы сыграть" in eff_low:
            actions.append({"type": "cost_reduction", "amount": int(m.group(1)),
                            "target": "this_card", "source_text": eff[:80]})
            return actions

    # ─── «восстанови N HP за каждый X» ───
    if not actions:
        m = re.search(r"восстанови\s+(\d+)\s*(?:HP|урона)\s*за\s+кажд(?:ый|ое)\s+([^,\.]+)", eff_low)
        if m:
            actions.append({
                "type": "heal_per",
                "amount": int(m.group(1)),
                "per": m.group(2).strip(),
                "subject": "self",
                "source_text": eff[:80],
            })
            return actions

    # ─── «нанеси N урона за каждые X карт» ───
    if not actions:
        m = re.search(r"нанеси\s+(\d+)\s*урона?\s+за\s+кажд(?:ые|ый)\s+(\d+)?\s*([^,\.]+)", eff_low)
        if m:
            actions.append({
                "type": "damage_per",
                "amount": int(m.group(1)),
                "per_count": int(m.group(2)) if m.group(2) else 1,
                "per_what": m.group(3).strip(),
                "source_text": eff[:80],
            })
            return actions

    # ─── «(следующая карта) стоит на N меньше» ───
    if not actions:
        if "следующ" in eff_low and "на" in eff_low and "меньше" in eff_low:
            m = re.search(r"на\s+(\d+)\s+меньше", eff_low)
            if m:
                actions.append({"type": "cost_reduction_on_next",
                                "amount": int(m.group(1)),
                                "source_text": eff[:80]})
                return actions

    # ─── «можешь бесплатно сыграть существо стоимостью N» ───
    if not actions:
        if "бесплатно" in eff_low and "сыграть" in eff_low:
            m = re.search(r"стоимост[ьи]\s+(\d+)?\s*или\s+менее", eff_low) or re.search(r"стоимост[ьи]\s+(\d+)?", eff_low)
            cost = int(m.group(1)) if (m and m.group(1)) else None
            target = "creature" if "существ" in eff_low else "any"
            actions.append({"type": "play_for_free", "target": target,
                            "cost_filter": cost, "source_text": eff[:80]})
            return actions

    # ─── «может тянуть карту / парнёр может тянуть» ───
    if not actions:
        if "тяни" in eff_low and ("партнёр" in eff_low or "другой" in eff_low or "союзник" in eff_low):
            m = re.search(r"тян(?:и|ет|ут)\s+(\d+)?\s*карт", eff_low)
            n = int(m.group(1)) if (m and m.group(1)) else 1
            actions.append(Draw(count=n, source="deck", filter="ally", source_text=eff[:80]))
            return actions

    # ─── «на этой линии посмотри вершнюю карту» / peek ───
    if not actions:
        if "посмотр" in eff_low:
            actions.append({"type": "peek", "count": 1, "source": "deck", "source_text": eff[:80]})
            return actions

    # ─── «можешь нанести 3 Урона выбранному существу» ───
    if not actions:
        if ("можешь" in eff_low) and "нанес" in eff_low:
            m = re.search(r"нанес[иы]?\s+(\d+)\s*[Уу]рона?", eff_low)
            if m:
                amount = int(m.group(1))
                target = resolve_target(eff_low) or Target.CHOSEN_OPPONENT_CREATURE
                actions.append(Damage(amount=amount, target=target, source_text=m.group(0)))
                return actions

    # ─── «также/и/получает/получает +N ATK/DEF» (пассивный бафф субъекта) ───
    if not actions:
        m = re.search(r"(?:он|она|оно|этот|этот\s+существо|это\s+существо|карта|существо|игрок)?\s*(?:получает|получит)?\s*\+(\d+)\s*(АТК|ATK|DEF|HP|атака|защит|здоров)\s*(?:в\s+этот\s+ход|в\s+этом\s+ходу)?", eff_low)
        if m:
            amount = int(m.group(1))
            stat_text = m.group(2).upper()
            stat = "attack" if stat_text in ("АТК", "ATK", "АТАКА") else ("defense" if stat_text in ("DEF", "ЗАЩИТ") else "health")
            duration = "this_turn" if ("этот ход" in eff_low or "этом ходу" in eff_low) else "persistent"
            target = Target.THIS_CREATURE
            actions.append(StatBuff(stat=stat, amount=amount, target=target, duration=duration, source_text=m.group(0)))
            return actions

    # ─── «+N ATK любому существу» (choose target for buff) ───
    if not actions:
        m = re.search(r"\+(\d+)\s*(АТК|ATK|DEF|HP|атака|защит)\s+любому\s+существ", eff_low)
        if m:
            amount = int(m.group(1))
            stat_text = m.group(2).upper()
            stat = "attack" if stat_text in ("АТК", "ATK", "АТАКА") else ("defense" if stat_text in ("DEF", "ЗАЩИТ") else "health")
            duration = "this_turn" if ("этот ход" in eff_low or "этом ходу" in eff_low) else "persistent"
            actions.append(StatBuff(stat=stat, amount=amount, target=Target.CHOSEN_CREATURE, duration=duration, source_text=m.group(0)))
            return actions

    # ─── «удваивается / увеличивается в N раз» (multiplier) ───
    if not actions:
        m = re.search(r"(атк|защит|hp|здоров|сил)\s+увеличива(?:ется|ют(?:ся)?)\s+в\s+(\d+)\s+раз", eff_low)
        if m:
            actions.append(StatBuff(stat="attack" if m.group(1) == "атк" else "defense",
                                    amount=f"x{m.group(2)}",
                                    target=Target.THIS_CREATURE,
                                    duration="persistent",
                                    source_text=m.group(0)))
            return actions
        if "удваивается" in eff_low and ("атк" in eff_low or "сил" in eff_low):
            actions.append(StatBuff(stat="attack", amount="x2",
                                    target=Target.THIS_CREATURE,
                                    duration="persistent",
                                    source_text="ATK удваивается"))
            return actions

    # ─── «можешь вернуть (X) в руку» (return to hand) ───
    if not actions:
        if "вернуть" in eff_low and ("руку" in eff_low or "свою руку" in eff_low):
            actions.append(ReturnFromDiscard(target=Target.THIS_CREATURE, cost_filter=None, destination=Target.HAND, source_text=eff[:80]))
            return actions
        if "берет ее себе на руку" in eff_low or "берет её себе на руку" in eff_low:
            actions.append(ReturnFromDiscard(target=Target.THIS_CREATURE, cost_filter=None, destination=Target.HAND, source_text=eff[:80]))
            return actions

    # ─── «можешь переместить X» (move to somewhere) ───
    if not actions:
        if "перемести" in eff_low:
            dest = Target.THIS_LANE
            if "пуст" in eff_low and "земл" in eff_low:
                dest = Target.THIS_LANE
            elif "свою" in eff_low and "сторон" in eff_low:
                dest = Target.THIS_LANE
            return_after = "конце хода верни" in eff_low
            actions.append(Move(target=Target.CHOSEN_CREATURE, destination=dest, return_after_battle=return_after, source_text=eff[:80]))
            return actions

    # ─── «сбрасывает N карт» (force discard) ───
    if not actions:
        m = re.search(r"сбрасыва(?:ет|ют)\s+(\d+)?\s*карт", eff_low)
        if m:
            n = int(m.group(1)) if m.group(1) else 1
            who = Target.EACH_OPPONENT if "кажд" in eff_low and "противник" in eff_low else Target.EACH_CREATURE
            actions.append(Discard(count=n, source="hand", random=False, source_text=m.group(0)))
            return actions

    # ─── «на N меньше» (cost reduction) ───
    if not actions:
        m = re.search(r"на\s+(\d+)\s+меньше", eff_low)
        if m and ("сыграть" in eff_low or "стоимост" in eff_low or "действ" in eff_low):
            actions.append({
                "type": "cost_reduction",
                "amount": int(m.group(1)),
                "target": "self" if "его" in eff_low or "чтобы сыграть" in eff_low else Target.NONE,
                "source_text": eff[:80],
            })
            return actions

    # ─── «можешь бесплатно сыграть X» ───
    if not actions:
        if "бесплатно" in eff_low and "сыграть" in eff_low:
            m = re.search(r"стоимост[ьи]\s+(\d+)?", eff_low)
            cost_filter = int(m.group(1)) if (m and m.group(1)) else None
            actions.append({
                "type": "play_for_free",
                "target": "creature" if "существо" in eff_low else "any",
                "cost_filter": cost_filter,
                "source_text": eff[:80],
            })
            return actions

    # ─── «найди X в колоде» ───
    if not actions:
        if "найди" in eff_low and "колод" in eff_low:
            actions.append(Search(source="deck", count=1, filter="any", destination=Target.HAND, source_text=eff[:80]))
            return actions

    # ─── «X не может быть уничтожен» (immunity) ───
    if not actions:
        if "не может быть уничтож" in eff_low:
            actions.append({"type": "immunity", "to": "destroy", "source_text": eff[:80]})
            return actions
        if "нельзя нанести" in eff_low and "урон" in eff_low:
            actions.append({"type": "immunity", "to": "damage_from_spells", "source_text": eff[:80]})
            return actions

    # ─── «тянет N карт» ───
    if not actions:
        m = re.search(r"тян(?:ет|ут)\s+(\d+)?\s*карт", eff_low)
        if m:
            n = int(m.group(1)) if m.group(1) else 1
            actions.append(Draw(count=n, source="deck", source_text=m.group(0)))
            return actions

    # ─── Damage: «наносит N урон» (с подлежащим вместо глагола) ───
    if not actions:
        m = re.search(r"нанос(?:ит|ят)\s+(\d+)\s*урона?", eff_low)
        if m:
            amount = int(m.group(1))
            rest = eff_low[m.end():].strip(" .,;:")
            target = resolve_target(rest) or base_target or Target.CHOSEN_OPPONENT_CREATURE
            actions.append(Damage(amount=amount, target=target, source_text=m.group(0)))

    # ─── Heal: «восстанови N HP|урона|здоров» ───
    if not actions:
        m = re.search(r"восстанов[и]?\s+(\d+)\s*(?:HP|урона|урон|здоров)", eff_low)
        if m:
            amount = int(m.group(1))
            cap_m = re.search(r"но не более\s+(\d+)", eff_low)
            cap = int(cap_m.group(1)) if cap_m else 25
            target = Target.SELF
            rest = eff_low[m.end():].strip(" .,;:")
            # «восстанови N HP X» — проверяем цель
            if "существ" in rest or "тво" in rest:
                target = Target.EACH_CREATURE
            elif "соседн" in rest:
                target = Target.ADJACENT_CREATURE
            actions.append(Heal(amount=amount, target=target, cap=cap, source_text=m.group(0)))

    # ─── Draw: «тяни N карт» ───
    if not actions:
        m = re.search(r"тяни\s+(\d+)?\s*карт", eff_low)
        if m:
            count = int(m.group(1)) if m.group(1) else 1
            actions.append(Draw(count=count, source="deck", source_text=m.group(0)))

    # ─── Discard: «сбрось N карт», «положи верхнюю карту в стопку сброса» ───
    if not actions:
        if "положи верхн" in eff_low and "стопк" in eff_low and "сброс" in eff_low:
            # Это комбинация: top_deck -> discard
            actions.append(Discard(count=1, source="deck", source_text=eff[:80]))
        elif "сбрось" in eff_low and "карт" in eff_low:
            m = re.search(r"сбрось\s+(\d+)?\s*карт", eff_low)
            count = int(m.group(1)) if (m and m.group(1)) else 1
            actions.append(Discard(count=count, source="hand", source_text=m.group(0) if m else eff[:50]))

    # ─── Destroy: «уничтожь X», «разрушь X» ───
    if not actions:
        m = re.search(r"(уничтожь|разрушь)\s+", eff_low)
        if m:
            target = resolve_target(eff_low) or Target.CHOSEN_OPPONENT_CREATURE
            count_m = re.search(r"(уничтожь|разрушь)\s+(\d+)", eff_low)
            count = int(count_m.group(2)) if count_m else 1
            actions.append(Destroy(target=target, count=count, source_text=m.group(0)))

    # ─── Move: «перемести X на Y» ───
    if not actions:
        m = re.search(r"перемести\s+([^,]+?)\s+на\s+([^,.]+)", eff_low)
        if m:
            subj = m.group(1).strip()
            dest = m.group(2).strip()
            return_after = "конце хода верни" in eff_low or "верни" in eff_low.split("перемести")[-1]
            target = resolve_target(subj) or Target.CHOSEN_CREATURE
            destination = Target.THIS_LANE
            if "свою сторон" in dest:
                destination = Target.THIS_LANE
            elif "соседн" in dest:
                destination = Target.ADJACENT_CREATURE
            elif "пустую лини" in dest or "пустую землю" in dest:
                destination = Target.THIS_LANE
            elif "противник" in dest:
                destination = Target.OPPONENT_LANE
            actions.append(Move(target=target, destination=destination, return_after_battle=return_after, source_text=m.group(0)))

    # ─── FlipLandscape: «переверни X лицом вниз/вверх» ───
    if not actions:
        m = re.search(r"переверни\s+([^,]+?)\s+(?:земл|землю|земля)?\s*(?:лицом\s+(вниз|вверх|вверх\s+или\s+вниз))?", eff_low)
        if m:
            target = Target.THIS_LANDSCAPE
            if "выбран" in eff_low or "указан" in eff_low:
                target = Target.CHOSEN_LANDSCAPE
            face = "down"
            if "вверх" in eff_low:
                face = "up"
            elif "вверх или вниз" in eff_low:
                face = "any"
            actions.append(FlipLandscape(target=target, face=face, source_text=m.group(0) if m.group(0) else eff[:50]))

    # ─── FreezeLandscape: «заморозь X», «заморозь обе земли на этой линии» ───
    if not actions:
        if "замороз" in eff_low and "земл" in eff_low:
            target = Target.THIS_LANDSCAPE_PAIR if "обе земли" in eff_low else Target.CHOSEN_LANDSCAPE
            actions.append(FreezeLandscape(target=target, source_text=eff[:80]))

    # ─── ReturnFromDiscard: «верни X из стопки сброса» ───
    if not actions:
        if "верни" in eff_low and "стопк" in eff_low and "сброс" in eff_low:
            cost_m = re.search(r"стоимост[ьи]\s+(\d+)", eff_low)
            cost_filter = int(cost_m.group(1)) if cost_m else None
            dest = Target.HAND
            if "игру" in eff_low or "в игру" in eff_low:
                dest = Target.THIS_LANE
            actions.append(ReturnFromDiscard(cost_filter=cost_filter, destination=dest, source_text=eff[:80]))

    # ─── Search: «найди X из своей колоды» (нпрм. «можешь найти Помощь») ───
    if not actions:
        if "найди" in eff_low or "находит" in eff_low:
            if "колод" in eff_low:
                actions.append(Search(source="deck", count=1, filter="any", destination=Target.HAND, source_text=eff[:80]))

    # ─── GainActions: «получи N действий(е)» ───
    if not actions:
        m = re.search(r"получ(?:и|и)\s+(\d+)\s*(?:действ|действие|действия)", eff_low)
        if m:
            count = int(m.group(1))
            actions.append(GainActions(count=count, source_text=m.group(0)))

    # ─── Stat buff в активируемой способности (+N ATK этому) ───
    if not actions:
        m = re.search(r"\+(\d+)\s*(АТК|ATK|DEF|HP|атака|защит|здоров)\s+(?:этому|этой|этот)", eff_low)
        if m:
            amount = int(m.group(1))
            stat_text = m.group(2).upper()
            stat = "attack" if stat_text in ("АТК", "ATK", "АТАКА") else ("defense" if stat_text in ("DEF", "ЗАЩИТ") else "health")
            target = Target.THIS_CREATURE
            duration = "this_turn" if "этот ход" in eff_low or "в этом ходу" in eff_low else "persistent"
            actions.append(StatBuff(stat=stat, amount=amount, target=target, duration=duration, source_text=m.group(0)))

    # ─── StatBuff для себя/существа ───
    if not actions:
        m = re.search(r"(?:этот|этого|этой)\s+(?:существо|карт[ау]?)?\s*(?:получает\s+)?\+(\d+)\s*(АТК|ATK|DEF|HP|атака|защит|здоров)", eff_low)
        if m:
            amount = int(m.group(1))
            stat_text = m.group(2).upper()
            stat = "attack" if stat_text in ("АТК", "ATK", "АТАКА") else ("defense" if stat_text in ("DEF", "ЗАЩИТ") else "health")
            target = Target.THIS_CREATURE
            duration = "this_turn" if "этот ход" in eff_low or "в этом ходу" in eff_low else "persistent"
            actions.append(StatBuff(stat=stat, amount=amount, target=target, duration=duration, source_text=m.group(0)))

    # ─── ConditionalBonus: «если HP < X, +N ATK» ───
    if not actions:
        m = re.search(r"если\s+(?:у\s+)?(?:эт[а-я]+\s+)?(?:HP|здоров)\s*(<|<=|>|>=|=)\s*(\d+)", eff_low)
        if m:
            threshold = int(m.group(2))
            op = m.group(1).replace("=", "")
            bonus = parse_actions_from_text(eff_low[m.end():])
            if bonus:
                actions.append(ConditionalBonus(
                    condition_stat="health",
                    threshold=threshold,
                    op=op,
                    bonus_action=bonus[0],
                ))

    return actions


# ───────── ПОСТРОЕНИЕ МЕХАНИКИ (trigger + actions + description) ─────────

def make_mechanic(trigger: str, actions: list, description: str, conditions=None, source_text=""):
    return {
        "trigger": normalize_trigger(trigger),
        "actions": [a.to_dict() if isinstance(a, Action) else a for a in actions],
        "conditions": conditions or [],
        "description": description,
        "source_text": source_text,
    }


# ───────── ОБХОД ОПИСАНИЯ ─────────

def find_mechanics(desc: str, has_flip_flag: bool) -> list:
    out = []
    seen = set()

    def push(m):
        sig = (m["trigger"], tuple(json.dumps(a, sort_keys=True, ensure_ascii=False) for a in m["actions"]), m["description"][:60])
        if sig in seen:
            return
        seen.add(sig)
        out.append(m)

    desc_low = desc.lower()

    # 1. FLOOP
    fm = RE_FLOOP.search(desc)
    if fm:
        effect = fm.group(1).strip().rstrip(".")
        # Triggers и actions — flip-ability обычно описывает действие
        actions = parse_actions_from_text(effect)
        push(make_mechanic(
            trigger="on_flip",
            actions=actions or [{"type": "flip_ability", "target": Target.NONE, "effect": effect}],
            description=effect,
            source_text=fm.group(0),
        ))

    # 2. Платный ПРИЕМ
    for m in RE_COST_ACCEPT.finditer(desc):
        cost = int(m.group(1))
        effect = m.group(2).strip().rstrip(".")
        actions = parse_actions_from_text(effect)
        push(make_mechanic(
            trigger="manual",
            actions=actions or [{"type": "manual", "target": Target.NONE, "effect": effect}],
            description=effect,
            conditions=[{"type": "cost_actions", "value": cost}],
            source_text=m.group(0),
        ))

    # 3. Условный ПРИЕМ (X, ПРИЕМ >>>)
    for m in RE_COND_ACCEPT.finditer(desc):
        condition = m.group(1).strip()
        effect = m.group(2).strip().rstrip(".")
        actions = parse_actions_from_text(effect)
        push(make_mechanic(
            trigger="manual",
            actions=actions or [{"type": "manual", "target": Target.NONE, "effect": effect}],
            description=effect,
            conditions=[{"type": "prerequisite", "description": condition}],
            source_text=m.group(0),
        ))

    # 4. Простой ПРИЕМ
    for m in RE_ACCEPT.finditer(desc):
        effect = m.group(1).strip().rstrip(".")
        raw = m.group(0).strip()
        if any(raw in mm.get("source_text", "") for mm in out):
            continue
        actions = parse_actions_from_text(effect)
        push(make_mechanic(
            trigger="manual",
            actions=actions or [{"type": "manual", "target": Target.NONE, "effect": effect}],
            description=effect,
            conditions=[{"type": "cost_actions", "value": 1}],
            source_text=raw,
        ))

    # 5. «Когда X вступает в игру/играется»
    for m in RE_ON_ENTERS.finditer(desc):
        effect = m.group(1).strip().rstrip(".")
        actions = parse_actions_from_text(effect)
        push(make_mechanic(
            trigger="on_play",
            actions=actions or [{"type": "passive", "target": Target.NONE, "effect": effect}],
            description=effect,
            source_text=m.group(0),
        ))

    # 6. «Когда X атакует»
    for m in RE_ON_ATTACK.finditer(desc):
        effect = m.group(1).strip().rstrip(".")
        actions = parse_actions_from_text(effect)
        push(make_mechanic(
            trigger="on_attack",
            actions=actions or [{"type": "passive", "target": Target.NONE, "effect": effect}],
            description=effect,
            source_text=m.group(0),
        ))

    # 7. Триггеры из списка (start_of_turn, on_death, etc.)
    for trigger_id, phrasings in PASSIVE_TRIGGERS:
        for p in phrasings:
            if p in desc_low:
                idx = desc_low.index(p)
                tail = desc[idx:].split("\n")[0]
                effect = tail.split(".")[0].strip() or p
                actions = parse_actions_from_text(effect)
                push(make_mechanic(
                    trigger=trigger_id,
                    actions=actions or [{"type": "passive", "target": Target.NONE, "effect": effect}],
                    description=effect[:200],
                    source_text=effect[:120],
                ))
                break

    # 8. «Если условие, эффект»
    for m in RE_IF.finditer(desc):
        condition = m.group(1).strip()
        effect = m.group(2).strip().rstrip(".")
        actions = parse_actions_from_text(effect)
        push(make_mechanic(
            trigger="conditional",
            actions=actions or [{"type": "passive", "target": Target.NONE, "effect": effect}],
            description=effect,
            conditions=[{"type": "if", "description": condition}],
            source_text=m.group(0),
        ))

    # 9. StatBuff (Каждое X получает +N ATK/DEF/HP)
    for m in RE_AURA_ATK.finditer(desc):
        amount = int(m.group(1))
        full = m.group(0)
        target = Target.EACH_CREATURE
        if "тво[её]" in full.lower():
            target = Target.EACH_CREATURE_YOURS
        elif "соседн" in full.lower():
            target = Target.EACH_CREATURE_ADJACENT
        duration = "this_turn" if ("в этом ход" in desc_low or "в этот ход" in desc_low) else "persistent"
        push(make_mechanic(
            trigger="persistent",
            actions=[StatBuff(stat="attack", amount=amount, target=target, duration=duration).to_dict()],
            description=full,
            source_text=full,
        ))

    for m in RE_AURA_DEF.finditer(desc):
        amount = int(m.group(1))
        full = m.group(0)
        target = Target.EACH_CREATURE
        if "тво[её]" in full.lower():
            target = Target.EACH_CREATURE_YOURS
        elif "соседн" in full.lower():
            target = Target.EACH_CREATURE_ADJACENT
        duration = "this_turn" if ("в этом ход" in desc_low or "в этот ход" in desc_low) else "persistent"
        push(make_mechanic(
            trigger="persistent",
            actions=[StatBuff(stat="defense", amount=amount, target=target, duration=duration).to_dict()],
            description=full,
            source_text=full,
        ))

    for m in RE_AURA_HP.finditer(desc):
        amount = int(m.group(1))
        full = m.group(0)
        push(make_mechanic(
            trigger="persistent",
            actions=[Heal(amount=amount, target=Target.EACH_CREATURE, source_text=full).to_dict()],
            description=full,
            source_text=full,
        ))

    # 10. +N ATK этому в этом ходу
    for m in RE_MOD.finditer(desc):
        amount = int(m.group(1))
        stat_text = m.group(2).upper()
        stat = "attack" if stat_text in ("АТК", "ATK", "АТАКА") else ("defense" if stat_text in ("DEF", "ЗАЩИТ") else "health")
        full = m.group(0)
        push(make_mechanic(
            trigger="on_play",
            actions=[StatBuff(stat=stat, amount=amount, target=Target.THIS_CREATURE, duration="this_turn").to_dict()],
            description=full,
            source_text=full,
        ))

    # 11. «Пока X, Y» (persistent conditional)
    for m in RE_WHILE.finditer(desc):
        condition = m.group(1).strip()
        effect = m.group(2).strip().rstrip(".")
        actions = parse_actions_from_text(effect)
        push(make_mechanic(
            trigger="persistent",
            actions=actions or [{"type": "passive", "target": Target.NONE, "effect": effect}],
            description=effect,
            conditions=[{"type": "while", "description": condition}],
            source_text=m.group(0),
        ))

    # 12. Императив (Уничтожь X, Верни Y)
    for m in IMPERATIVE.finditer(desc):
        verb = m.group(1).strip()
        effect = m.group(2).strip().rstrip(".")
        raw = m.group(0).strip()
        if any(raw in mm.get("source_text", "") for mm in out):
            continue
        actions = parse_actions_from_text(raw)
        push(make_mechanic(
            trigger="manual",
            actions=actions or [{"type": "imperative", "verb": verb, "target": Target.NONE, "effect": effect}],
            description=effect,
            conditions=[{"type": "verb", "value": verb}],
            source_text=raw,
        ))

    # 13. Если карта помечена has_flip — добавляем flip_ability
    if has_flip_flag and not any(m["trigger"] == "on_flip" for m in out):
        push(make_mechanic(
            trigger="on_flip",
            actions=[{"type": "flip_ability", "target": Target.NONE, "effect": "(см. flip_description)"}],
            description="(flop ability — see flip_description)",
            source_text="(based on has_flip flag)",
        ))

    return out


def detect_flip(desc: str) -> tuple:
    desc_low = desc.lower()
    fm = re.search(r"FLOOP\s*>>>\s*([^.\n]+)", desc, re.IGNORECASE)
    if fm:
        return True, fm.group(1).strip().rstrip(".")
    if "переверни эту карту" in desc_low or "переворачивает" in desc_low:
        for kw in ["переверни эту карту", "переворачивает"]:
            if kw in desc_low:
                idx = desc_low.index(kw)
                snippet = desc[idx:].split(".")[0]
                return True, snippet.strip()
    return False, ""


def parse_card(card: dict) -> dict:
    desc = (card.get("description") or card.get("ability_text") or "").strip()
    if not desc:
        card["mechanics"] = []
        card["has_flip"] = False
        card["flip_description"] = ""
        return card

    has_flip, flip_desc = detect_flip(desc)
    mechanics = find_mechanics(desc, has_flip)

    # Sync flip_description с flip_ability
    fa = next((m for m in mechanics if m["trigger"] == "on_flip"), None)
    if fa and flip_desc and not fa.get("description", "").strip():
        fa["description"] = flip_desc

    card["has_flip"] = has_flip
    card["flip_description"] = flip_desc
    card["mechanics"] = mechanics
    return card


def main():
    if not SRC.exists():
        print(f"❌ Не нашёл {SRC}")
        sys.exit(1)

    with open(SRC, encoding="utf-8") as f:
        data = json.load(f)

    parsed = no_desc = flip_count = 0
    type_counter = {}
    trigger_counter = {}
    action_type_counter = {}

    for key, rec in data.items():
        if not (rec.get("description") or rec.get("ability_text")):
            no_desc += 1
            rec["mechanics"] = []
            rec["has_flip"] = False
            rec["flip_description"] = ""
            continue
        parse_card(rec)
        parsed += 1
        if rec["has_flip"]:
            flip_count += 1
        for m in rec["mechanics"]:
            trigger_counter[m["trigger"]] = trigger_counter.get(m["trigger"], 0) + 1
            for a in m["actions"]:
                t = a.get("type", "?")
                action_type_counter[t] = action_type_counter.get(t, 0) + 1

    with open(DST, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"📥 Загружено {len(data)} карт")
    print(f"✅ Обработано {parsed} (без описания: {no_desc})")
    print(f"   flip-способностей: {flip_count}")
    print()
    print("=== Триггеры механик ===")
    for t, c in sorted(trigger_counter.items(), key=lambda x: -x[1]):
        print(f"  {c:>4}× {t}")
    print()
    print("=== Типы Action (структурированно) ===")
    for t, c in sorted(action_type_counter.items(), key=lambda x: -x[1]):
        print(f"  {c:>4}× {t}")

    print()
    print("=== Пример структурированной механики ===")
    for k, v in data.items():
        if v.get("mechanics") and any(a.get("type") == "deal_damage" for m in v["mechanics"] for a in m["actions"]):
            print(json.dumps({"name": v["name"], "description": v["description"], "mechanics": v["mechanics"]}, ensure_ascii=False, indent=2))
            break

    size = DST.stat().st_size
    print(f"\n📦 {DST}: {size:,} байт ({size/1024:.1f} KB)")


if __name__ == "__main__":
    main()
