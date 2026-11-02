# mechanics/ — привязка механик к героям (docs/MECHANICS-V2.md)

Один JSON-файл на героя: `content/heroes/mechanics/<heroId>.json`. Формат способности — тот же, что у карт; активации героя — командой `hero_ability` (стоимость, доп. стоимость, цели, «раз за ход» — по данным).

```json
{
  "heroId": "hero_bmo",
  "name": "БиМО",
  "ability": {
    "kind": "active",
    "oncePerTurn": true,
    "additionalCost": { "discardFromHand": 1 },
    "effect": { "op": "deal_damage", "target": { "kind": "choice", "index": 0 }, "amount": 1 },
    "targets": [{ "kind": "opponent_player" }],
    "text": "Сбрось карту с руки >>> Нанеси 1 урон выбранному противнику"
  }
}
```

Пассивные герои — `kind: "passive"` с `trigger` или без него (аура). `heroId` должен существовать в `../json/`.
