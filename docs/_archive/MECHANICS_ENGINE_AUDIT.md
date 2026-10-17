# Аудит механик каталога и Worker-движка

Дата проверки: 24 сентября 2026
Ветка: `tester_00005`

## Начатый переход

После аудита начат жёсткий переход на authoritative runtime:

- `supabase/migrations/20260924120000_cards_mechanics_runtime_metadata.sql` добавляет `mechanics_version` и `mechanics_status`;
- `GameRoom` загружает `CATALOG/cards` из KV и передаёт карты в `GameState.catalog`;
- `workers/src/game-engine/mechanics-runtime.ts` dispatch'ит поддерживаемые действия;
- добавлено серверное действие `use_ability`;
- spell-карты разрешаются и уходят в discard;
- ручная атака использует выбранные attacker/target;
- добавлен counterattack;
- исправлен flip mark и catalog lookup;
- native snapshot сохраняется обратно в LobbyRoom;
- текстовые способности получают `mechanics_status=text_only` и не исполняются.

Это первый runtime-каркас, а не полная ручная реализация всех 504 текстовых способностей. В каталоге сейчас 89 карт помечены `implemented`, 415 — `text_only`.

## Итог

Формат каталога после нормализации пригоден для хранения, но текущий игровой движок **ещё не исполняет механики карт**. `individual_cards/cards_supabase.sql` является seed-файлом каталога, а не гарантией корректной игровой логики.

Главная проблема находится не в SQL, а в отсутствии runtime-слоя:

- `workers/src/game-engine/mechanics.ts` содержит типы, классы и `hydrateMechanics()`;
- `hydrateMechanics()` не вызывается из `engine.ts`, `cards.ts`, `combat.ts` или `turn.ts`;
- базовый `Action.apply()` всегда возвращает `applied: false`;
- ни один subclass Action не переопределяет `apply()`;
- триггеры не регистрируются и не вызываются игровым циклом.

Следовательно, наличие `mechanics` в БД/KV сейчас означает только наличие описания способности. Оно не означает, что способность применится в игре.

## Текущий путь данных

```text
individual_cards/cards.json
        ↓
individual_cards/cards_supabase.sql
        ↓
public.cards.mechanics (JSONB)
        ↓
scripts/migrate-catalog-to-kv.mjs
        ↓
Cloudflare KV: CATALOG/cards
        ↓
Worker catalog snapshot
        ↓
GameRoom / GameState
        ↓
game-engine
```

На последнем переходе сейчас есть разрыв: каталог и `mechanics` попадают в KV, но runtime-движок не подключает их к событиям игры.

## Что уже работает

| Часть | Состояние |
|---|---|
| Проверка хода и активного игрока | работает |
| Стоимость карты при обычном `play_card` | работает без учёта способностей |
| Проверка земли | работает в отдельных случаях |
| Обычная атака и базовый урон | работает |
| Бесплатный и платный добор | работает |
| Flip-проверка наличия | частично работает |
| Переключение flipped-состояния | работает технически |
| Исполнение `deal_damage` из механик | не работает |
| Исполнение `heal`, `draw_cards`, `discard_cards` | не работает |
| Исполнение `stat_buff` | не работает |
| `on_enters_play` | не вызывается |
| `start_of_turn` | не вызывается |
| `on_creature_attacks` | не вызывается |
| `persistent` / `conditional` | не вычисляются |
| Пассивные и текстовые способности | только отображаются/сохраняются |

## Критические проблемы движка

### P0 — механики не подключены к игровому циклу

`mechanics.ts` заканчивается на `Mechanic` и гидраторе. `Action.apply()` не реализован ни в одном классе. Нет функции вида:

```ts
dispatchMechanics(state, event, ownerCard, targets)
```

Из-за этого даже полностью корректный JSON не изменит состояние партии.

### P0 — отсутствует действие активации способности

В `types.ts` есть `play_card`, `attack`, `flip_card`, draw и discard, но нет `use_ability` / `activate_mechanic`. Поэтому `manual`-механики невозможно вызвать из клиента и невозможно валидировать на сервере.

### P0 — триггеры не имеют событийной модели

Нужны явные события и порядок их обработки:

```text
card_played
on_enters_play
turn_started
turn_ended
attack_started
damage_dealt
damage_taken
creature_killed
card_discarded
line_changed
card_flipped
```

Для каждого события нужен ordered dispatch. Сейчас `endTurn()` только выполняет бой, а `playCard()` только перемещает карту.

### P0 — условия не исполняются

`conditions` имеют типы `prerequisite`, `if`, `while`, `verb`, но условия не проверяются. Если просто подключить dispatch сейчас, способности с условиями будут выполняться безусловно — это хуже, чем текущее отсутствие исполнения.

Условия нужно представить исполняемыми предикатами:

```json
{ "type": "if", "predicate": "discard_count_gte", "value": 10 }
{ "type": "while", "predicate": "self_damage_gte", "value": 4 }
{ "type": "requires", "predicate": "has_friendly_creature_on_land", "land_type": "swamp" }
```

### P0 — `Imperative` теряет `effect`

В `hydrateAction()` ветка `imperative` передаёт `verb`, `target` и `source_text`, но не передаёт `effect`. Для generic-механик текст эффекта может исчезнуть после гидратации. Это нужно исправить до использования hydrator в runtime.

### P0 — spell-карты остаются на поле

`playCard()` кладёт `spell` в зону и больше не выполняет её эффект. В текущем combat spell исключается из атаки, но остаётся в зоне и влияет на заполненность зоны. Правильная модель:

1. сыграть spell;
2. выполнить её on-play/manual actions;
3. отправить spell в discard;
4. не оставлять её в zone.

### P0 — flip только переключает флаг

`flipCard()` не исполняет `flip_ability`. Кроме того:

- `canFlipCard()` игнорирует `flip_ability.cost` и использует жёстко `cost = 0`;
- при перевороте `flipped_this_turn` выставляется неправильно;
- нет защиты от повторного/некорректного срабатывания способности;
- нет единого события `card_flipped`.

### P0 — состояние не содержит временных эффектов

Для `stat_buff` с `duration: this_turn` нет:

- модификаторов атаки/защиты отдельно от базового значения;
- временных buff-записей;
- очистки в конце хода;
- порядка применения нескольких баффов;
- защиты от повторного применения one-shot способности.

Нельзя просто менять `card.attack` напрямую: это ломает базовые характеристики, отображение карты и следующие ходы.

### P1 — каталог не подключён к `GameState.catalog`

В `types.ts` есть `GameState.catalog`, а `cards.ts` его читает. Но `rawToGameState()` его не заполняет, а `getCardIndex()` из `catalog.ts` не используется game-room. Engine чаще полагается на поля, случайно попавшие в snapshot карты. Для механик нужен гарантированный lookup каталога по `card.id`.

### P1 — `card_type` не полностью совпадает

Worker `Card` поддерживает только `creature | building | spell`. В каталоге есть 5 карт `special`, а SQL временно переводит их в `spell`. Это нормально для текущей схемы, но `special` нельзя добавлять в Worker без отдельного игрового поведения.

### P1 — пассивные способности требуют continuous modifier system

`persistent` и `conditional` нельзя исполнять как обычный一次性 action. Нужна модель:

```text
ability source + condition + modifier/effect + duration
```

Например:

```json
{
  "trigger": "persistent",
  "actions": [{
    "type": "stat_buff",
    "target": "this_creature",
    "stat": "attack",
    "amount": 2,
    "duration": "while_condition"
  }],
  "conditions": [{
    "type": "while",
    "predicate": "self_damage_gte",
    "value": 4
  }]
}
```

### P1 — старый SQL и Worker могут конкурировать

В `supabase/migrations` остаются SQL-функции боя, `end_turn`, `perform_attack` и других действий. Если клиент или другой путь вызывает их напрямую, правила могут отличаться от Worker. Нужно выбрать один источник истины:

- либо Worker — единственный исполнитель, SQL RPC только snapshot/совместимость;
- либо SQL — runtime, а Worker только проксирует RPC.

Сейчас архитектура явно движется к Worker, поэтому рекомендуется первый вариант.

## Состояние текущего каталога

После нормализации `individual_cards/cards.json`:

- 504 карты;
- 493 карты имеют хотя бы одну механику;
- 11 карт без механик;
- 12 trigger types встречаются в данных;
- 22 action types встречаются в данных;
- 247 карт содержат хотя бы одно generic/text-only действие;
- 290 mechanic objects используют поддерживаемые типы действий, но это не означает, что они исполняются;
- 253 mechanic objects требуют отдельной реализации или ручной проверки.

Основные trigger-ы в данных:

- `manual` — 315;
- `conditional` — 57;
- `on_enters_play` — 59;
- `persistent` — 55;
- `start_of_turn` — 23;
- `on_creature_attacks` — 21.

## Дополнительные P0/P1 проблемы, найденные независимым аудитом

### P0 — ручная атака игнорирует выбранные карту и цель

`applySingleAttack()` передаёт в `resolveAttack()` только `actorId` и `fromZone`. Поля `attackerCardId`, `toPlayerId` и `toZone` из клиентского action теряются. Resolver выбирает первую доступную существующую карту и заново вычисляет противника по lane.

В результате можно выбрать карту B, а фактически атакует карта A; аналогично можно передать одну цель, а урон уйдёт другой. `resolveAttack()` должен принимать authoritative target object и отклонять несовпадение с `pickBattleTarget()`.

### P0 — нет контрattack

Worker наносит урон только атакующему существу. Защищающееся существо не наносит одновременный ответный урон, хотя legacy SQL-миграции уже реализуют counterattack. Перед переписыванием механик нужно зафиксировать единое правило и добавить одновременный расчёт урона обоих существ.

### P0 — неверное окно атаки для двух игроков

`canPlayerDealDamage()` разрешает атаку только `player_order === 1` начиная со второго хода. Второй игрок в партии на двоих не может атаковать ни на каком ходу. Legacy SQL использует другое правило. Сначала нужна одна rule-spec таблица и golden tests Worker ↔ SQL.

### P0 — `slotType` клиента не является доверенным

`play_card` принимает `slotType` из payload и может разместить building как creature или наоборот. `slotType` должен вычисляться из доверенной карки/catalog, а клиентский параметр использоваться только как проверяемый hint.

### P0 — скрытый автодобор

`playCard()` автоматически дополняет руку до 5 карт, а `endTurn()` автоматически добавляет следующему игроку карту. Одновременно существуют отдельные `draw_free`/`draw_paid` actions, а legacy SQL запрещает auto-draw. Нужно выбрать один канон и удалить либо auto-refill, либо UI/RPC-автодобор.

### P0 — native/local state не переживает перезапуск

`GameRoom.persistSnapshot()` пропускает native game, а LobbyRoom отдаёт начальное состояние через read-only endpoint. После eviction GameRoom может загрузить исходные руки и потерять все plays/attacks/flips/end turns. Snapshot должен сохраняться обратно в Durable Object/LobbyRoom после каждой транзакции либо в DO storage.

### P1 — unrestricted discard

`discard_from_hand` и `discard_from_zone` доступны как обычные клиентские actions, не требуют причины, стоимости, контекста способности и не проверяют protected/tapped. Если discard — внутренний эффект, его нужно убрать из public protocol и вызывать только через `use_ability`/engine action.

### P1 — setup bypass и readiness

`confirm_land_setup` опирается на произвольный client-controlled `bypass`, а readiness не хранится на каждого игрока. `Boolean("false")` также превращается в `true`. Нужны per-player `land_setup_ready`, server-side-only transition и строгий payload parser.

### P1 — exact-lethal и пустые события

При `attack === hp` Worker может оставить существо с `health: 0`; lethal-семантику нужно утвердить и исправить в Worker и SQL одновременно. `endTurn()` также добавляет пустые battle events, если атаки не было.

### P1 — turn_started_at обновляется на каждом action

`bumpVersion()` обновляет `turn_started_at` на play/draw/discard/flip, хотя это timestamp начала хода. Нужно разделить version bump и turn-start timestamp.

### P1 — потеря state до snapshot

Native game сохраняется не после каждого action, а пакетно; часть действий может потеряться при перезапуске. Idempotency keys и monotonic revision также должны сохраняться вместе со snapshot.

## Что нужно переписать

### Безопасный минимум перед началом игры

1. Создать `mechanics-runtime.ts` с registry действий и строгим `dispatch`.
2. Добавить `use_ability` в протокол, `Action`, payload conversion и UI.
3. Добавить события `play`, `turn_start`, `attack`, `damage`, `death`, `discard`, `flip`.
4. Перевести все механики в runtime-ready envelope.
5. Исправить `Imperative.effect`.
6. Исправить spell lifecycle.
7. Исправить flip state и flip cost.
8. Добавить temporary/continuous modifiers.
9. Подключить `GameState.catalog` через `getCardIndex()`.
10. Добавить тесты «механика → состояние → broadcast → snapshot».

### Что можно отложить

- полный редактор всех 253 generic-механик;
- сложные предикаты для всех текстовых условий;
- визуальный интерфейс выбора целей;
- отдельные таблицы для каждой способности.

## Нужен ли rewrite JSON

Полный rewrite каталога не нужен. Формат `trigger/actions/conditions` выбран правильно. Но до runtime нужно зафиксировать контракт:

```json
{
  "trigger": "manual",
  "actions": [
    {
      "type": "deal_damage",
      "target": "chosen_opponent_creature",
      "amount": 1
    }
  ],
  "conditions": [],
  "description": "...",
  "source_text": "..."
}
```

Для неподдерживаемых правил нужен явный статус, а не неявный `imperative`:

```json
{
  "trigger": "manual",
  "actions": [],
  "conditions": [],
  "execution": {
    "status": "text_only",
    "reason": "handler_not_implemented"
  },
  "description": "..."
}
```

Это безопаснее: движок не будет считать текст исполненной способностью.

## Рекомендуемый порядок работ

1. Зафиксировать SQL-аудит и контракт версии 1.
2. Переписать только runtime механик, не меняя 504 карты.
3. Сделать 10–20 базовых механик полностью playable.
4. Прогнать тесты и игру.
5. После стабилизации расширять action registry.
6. Только после этого переводить generic/text-only способности в executable-формат.

## SQL

- `individual_cards/mechanics_engine_audit.sql` — безопасная read-only диагностика существующей БД.
- `individual_cards/mechanics_schema_v2_draft.sql` — черновик будущего контракта и необязательных изменений схемы; файл намеренно не применять автоматически.

Схему Supabase в рамках текущей задачи не менять.
