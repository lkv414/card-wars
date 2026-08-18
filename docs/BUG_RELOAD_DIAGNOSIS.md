# Bug diagnosis: board reload on card creation

## Stack confirmed
- React 19 + Vite 8
- R3F 9 + drei 10 + three 0.185
- Zustand 5 (gameStore, uiStore) with serverVersion + optimistic patches
- Supabase realtime + Cloudflare Workers WS
- Same stack as testing_3d reference

## What "board reload" actually means in this codebase

A "board reload" symptom in R3F terms is any of:
1. Whole `<Canvas>` remount (game crashes & remounts via Suspense boundary).
2. Every mesh in the scene re-created (children of `<Canvas>` change identity
   even though content is identical → all geometries/materials re-instantiated
   and `useFrame` callbacks re-bound).
3. Camera/OrbitControls reset (target jumps to (0,0,0)).
4. Lights/Environment re-mounted (IBL re-baked, brief darkness flash).
5. useLoader Suspense throws → entire tree shows fallback → mesh flicker.

## Root causes found (5)

### RC1. `GameObject` uses `useLoader` per card → Suspense thrash
File: `src/components/Game/scene/GameObject.jsx`

```js
const texture = useLoader(CachedTextureLoader, textureUrl)
const memoTexture = useMemo(() => texture, [texture])
```

Every `GameObject` registers a Suspense throw via R3F's `useLoader`.
When the URL changes (which happens every play because new cards get new
`instanceId` and sometimes fresh URLs from `resolveCardImageUrl`), the
surrounding Suspense boundary suspends. The boundary in
`GameCanvas.jsx` is `<Suspense fallback={null}>{children}</Suspense>` — so
the entire 3D tree unmounts and remounts. Every mesh re-instantiated.
Lights re-mounted. Camera reset.

Testing_3d does NOT use `useLoader` — it draws a solid material per object.

### RC2. `resolveCardImageUrl` re-creates URL on every render
File: `src/utils/enrichGameCards.js` (and called in `GameObject.jsx:225`)

Until the catalog finishes loading, `image_url` may be undefined on the
catalog record and the URL is regenerated. Even after enrichment, every
call to `resolveCardImageUrl(card)` may allocate a new string identity if
the catalog map mutates. The URL prop to `useLoader` changes → new
suspense → RC1.

### RC3. `applyPlayCardPatch` rebuilds zones with shallow copy
File: `src/utils/gameStatePatch.js:332-386`

Every player object gets `{ ...player, hand: ..., zones: zoneRows, ... }`.
But zones that didn't change keep the **same array reference** for
unaffected zone indexes (good — except `zoneRows[zoneIndex]` is replaced
unconditionally, even when the new row's cards array is structurally
equal to the old one). Combined with `enrichCard` returning a *new*
object on the placed card, the `placed` reference always changes. Result:
the placed card's `GameObject` re-renders, but its sibling zones'
`GameObject`s get new `card` prop identities because they live inside a
new zones array → memo on `card={card}` re-fires → textures re-loaded.

### RC4. `useGameEnrichment` calls `applyServerState` after every play
File: `src/hooks/game/useGameEnrichment.js:55`

```js
store.applyServerState(next, 'enrich:cards')
```

This runs because `game.version` changed (after play). It re-applies a
*fully enriched* game state. Even with the store's dedup, the `players`
array is re-mapped (new identity), and React doesn't know references are
shallow-equal. So `GameBoard3D` re-renders, the memo `gamesEqual` skips
it correctly, but inside the new memo cycle, `zones = useMemo(...)`
returns the same array (good) but `handCards` is recomputed (it's a
function returning a fresh array — so same content, new identity). That
identity change cascades into every `<GameObject key={...}>` for cards
on the field whose `card` prop comes from `creatureCard`/`buildingCard`
(also freshly destructured in render → new object identity).

### RC5. R3F `<group>` for cards re-mounts on key change
File: `src/components/Game/GameBoard3D.jsx:399,429`

```js
key={`creature-${creatureCard.id ?? creatureCard.instanceId}-${zone.player.player_id}`}
```

When `applyPlayCardPatch` re-enriches the placed card and the catalog
adds new fields, `creatureCard.id` might still match — but
`creatureCard.instanceId` may differ between runs (in fallback path of
`usePlayCard.js:229` we assign `card.instanceId || card.id || ...`). So
the key may flip on every play → React unmounts old GameObject, mounts
new one → R3F re-creates mesh + material + re-suspends on texture load.

## Pattern to copy from testing_3d

testing_3d's `SceneObject.jsx` is short and stateless per-instance:
- No `useLoader` per mesh.
- `<mesh>` with a `<meshStandardMaterial color={object.color} ... />`
  only — no texture.
- `Outlines` for selection (Drei handles outline separately from material).
- `<group>` key = `object.id` (stable from `createSceneObject`).
- One owner (`useState` in `App.jsx`), no Zustand, no async patching.

For the card-game we can't drop textures. But we can:
- Replace `useLoader` with a synchronous cached texture from `textureCache`
  (it already returns a Promise, but R3F's `useTexture` (drei) or a small
  custom hook with `useState`+`useEffect` works without Suspense).
- Stabilize key per card (instanceId from server, set once).
- Memoize per-zone children to avoid re-render on unrelated zone changes.

## Fix plan (in plan_step_03..07)

1. Add a `<CachedTexture>` helper that loads texture via `textureCache`
   with a Suspense-free pattern (subscribe + state).
2. Use it in `GameObject` instead of `useLoader`.
3. Stabilize `placed.instanceId` in `applyPlayCardPatch` (use
   `cardSource.instanceId ?? cardSource.id ?? ...` once, consistently).
4. Memoize children of `<GameCanvas>` with stable keys for zones.
5. Add tests for the new helper.
