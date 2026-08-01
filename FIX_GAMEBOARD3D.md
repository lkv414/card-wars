# Обязательные правки в `src/components/Game/GameBoard3D.jsx`

## 1. `handleLandClick` — не передавать `myIndex` как `actionCost`

```js
await onPlayCard(selectedCardIndex, zoneIndex, 1)
// было: await onPlayCard(selectedCardIndex, zoneIndex, myIndex)
```

## 2. Карты в зонах — после `loadGame` это уже массивы карт, не `{ cards: [] }`

**Противник:**
```js
const opponentZones = Array.isArray(opponent.zones) ? opponent.zones : [[], [], [], []]
// ...
const cards = Array.isArray(opponentZones[i]) ? opponentZones[i] : []
```

**Свои земли:**
```js
const cards = Array.isArray((me?.zones || [])[i]) ? me.zones[i] : []
```

## 3. Прокинуть `onPlayCard` в HUD (для drag-and-drop)

```jsx
<HUDOverlay
  ...
  onPlayCard={onPlayCard}
/>
```

## 4. SQL (обязательно применить в Supabase SQL Editor)

Файл: `supabase/migrations/20260801120000_end_turn_rpc.sql`

Без этого RPC `end_turn` / `forfeit_game` клиент получит ошибку «function does not exist».
