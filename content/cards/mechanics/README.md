# mechanics/ — привязка механик к картам (docs/MECHANICS-V2.md)

Один JSON-файл на карту со способностями: `content/cards/mechanics/<cardId>.json`.

```json
{
  "cardId": "bmo_card_12",
  "name": "Желтая сирена",
  "abilities": [
    {
      "kind": "passive",
      "trigger": "on_enters_play",
      "effect": { "op": "deal_damage", "target": { "kind": "this_lane_opponent_creature" }, "amount": 3 },
      "text": "Когда вступает в игру — 3 урона существу противника на этой линии"
    }
  ]
}
```

Правила:
- `cardId` — ключ связки (обязателен, должен существовать в `../json/`); `name` — только подсказка, сборка сверяет с каталогом.
- Способность: `kind` passive|active; у passive — `trigger` (`on_cast` для заклинаний) либо без него (модификатор-аура); у active — `cost` и опционально `additionalCost`.
- Ровно одно из `effect` (декларативная операция) или `mechanic` + `params` (именованная механика).
- `targets` — упорядоченные выборы игрока; `conditions` — if/while; `optional` — «можешь…»; `oncePerTurn` — раз за ход.
- Один `active` (ПРИЕМ) на карту. Файлы без способностей не создаются; карты без файла остаются без механик (отчёт покрытия — в выводе `pnpm --filter @card-wars/content generate`).
