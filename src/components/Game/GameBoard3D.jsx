/**
 * GameBoard3D — корневой компонент игровой 3D-сцены.
 *
 * По паттерну testing_3d: один owner стейта (useState здесь), чистая обёртка:
 *
 *   <div game-board-3d>
 *     <GameCanvas>
 *       <GameExperience>
 *         <OrbitControls> + зоны (GameLand + GameObject для карт)
 *       </GameExperience>
 *     </GameCanvas>
 *     <DamageFlashOverlay />
 *     <LandSetupOverlay />   ← если game.status === 'setup'
 *     <GamePanel />          ← HUDOverlay (hand, top bar, banners) ВНЕ Canvas
 *   </div>
 *
 * Вся 3D-логика вынесена в scene/*; домен (game, players, WS, RPC) приходит
 * сверху как пропы и не меняется.
 */
import { useMemo, useState, useCallback, useRef, useEffect, memo } from 'react'

import { GameCanvas } from './scene/GameCanvas'
import { GameExperience } from './scene/GameExperience'
import { GameObject } from './scene/GameObject'
import { GameLand } from './scene/GameLand'
import { GamePanel } from './scene/GamePanel'
import { PlayerNameLabels } from './scene/PlayerNameLabels'
import { GameDamageFloater } from './scene/GameDamageFloater'

import { DamageFlashOverlay } from './DamageFlashOverlay'
import { LandSetupOverlay } from './LandSetupOverlay'
import { ZoneCardActionMenu } from './hud/ZoneCardActionMenu'

import { canPlayerDealDamage } from '../../hooks/game/combat'
import { battleEventsToVisuals } from '../../hooks/game/battlePhase'
import { useGraphicsSettings } from '../../hooks/useGraphicsSettings'
import { safePlayers, safePlayer } from '../../utils/safePlayer'

import {
  CARD_OBJECT_TYPES,
} from '../../utils/cardSceneHelpers'
import {
  calculateTwoPlayerBoard,
  calculatePlayerSlotPositions,
  PLAY_FIELD_Y,
  computeFieldCardScale,
  getLandSlotLayout,
} from '../../utils/gameObjectPlacement'
import { makeCardKey } from '../../utils/cardKey'

import { normalizePlayerZoneRows, normalizeZoneCards } from '../../hooks/game/format'
import { splitZoneCards } from '../../hooks/game/zoneCards'

/**
 * Стабилизировать {creature, building} для каждой зоны.
 *
 * RC3/R4 из docs/BUG_RELOAD_DIAGNOSIS.md:
 *   splitZoneCards() возвращает свежие объекты при каждом вызове.
 *   Если вызывать его прямо в render — creatureCard всегда новая identity,
 *   даже когда контент идентичен → memo() в GameObject промахивается →
 *   меш пересоздаётся. Здесь кэшируем по identity входного массива карт.
 *
 * Алгоритм: собираем массив всех cards-массивов (по порядку player/zone),
 * мемоизируем результат по его identity. Если ничего не поменялось —
 * возвращаем тот же Map. Если хоть один cards-массив сменил identity —
 * пересобираем Map.
 */
function useStableZoneCards(players) {
  // Сначала собираем массив (zoneKey, cardsArray) — это всё, что нам
  // нужно для стабильности. Не используем ref в render (eslint
  // react-hooks/refs правило).
  const cardsByZoneKey = useMemo(() => {
    const out = []
    for (const player of players || []) {
      const zoneRows = normalizePlayerZoneRows(player.zones)
      for (let zi = 0; zi < zoneRows.length; zi++) {
        const row = zoneRows[zi]
        if (!row) continue
        const cards = normalizeZoneCards(row)
        out.push([`${player.player_id}:${zi}`, cards])
      }
    }
    return out
  }, [players])

  return useMemo(() => {
    const map = new Map()
    for (const [key, cards] of cardsByZoneKey) {
      map.set(key, splitZoneCards(cards))
    }
    return map
  }, [cardsByZoneKey])
}

const FIELD_CARD_SCALE = computeFieldCardScale(0.88)

/**
 * Собирает список зон на поле с координатами и владельцами.
 */
function buildBoardZones(players, myIndex) {
  const playerCount = players.length
  if (playerCount === 2) {
    const sharedLanes = calculateTwoPlayerBoard(myIndex)
    return sharedLanes.flatMap((lane) => {
      const nearPlayer = players[lane.near.playerIndex]
      const farPlayer = players[lane.far.playerIndex]
      return [
        { ...lane.near, player: nearPlayer, isOwnerMe: true },
        { ...lane.far, player: farPlayer, isOwnerMe: false },
      ].filter((z) => z.player && (z.player.health ?? 0) > 0)
    })
  }
  const zones = []
  for (let i = 0; i < playerCount; i++) {
    if (i === myIndex) continue
    const opp = players[i]
    if (!opp || (opp.health ?? 0) <= 0) continue
    const positions = calculatePlayerSlotPositions(i, playerCount)
    for (const p of positions) {
      zones.push({ ...p, player: opp, isOwnerMe: false })
    }
  }
  const me = players[myIndex]
  if (me && (me.health ?? 0) > 0) {
    const myPositions = calculatePlayerSlotPositions(myIndex, playerCount)
    for (const p of myPositions) {
      zones.push({ ...p, player: me, isOwnerMe: true })
    }
  }
  return zones
}

export function GameBoard3D({
  game,
  playerId,
  landCatalog = {},
  onGameEnd,
  onPlayCard,
  onDrawFreeCard,
  onDrawPaidCard,
  onShuffleDeck,
  onDiscardFromHand,
  onEndTurn,
  onSuppressRealtimeReload,
  onForfeit,
  onReorderLands,
  onConfirmLandSetup,
  onSkipLandSetup,
  onFlipCard,
  onDiscardFromZone,
  realtimeStatus = 'connecting',
  isApplying = false,
  actionError = null,
  toast = () => {},
}) {
  const { shadowsEnabled } = useGraphicsSettings()

  // === Visual state (testing_3d pattern: один owner) ===
  const [selectedCardIndex, setSelectedCardIndex] = useState(null)
  const [selectedZoneIndex, setSelectedZoneIndex] = useState(null)
  const [draggingCardIndex, setDraggingCardIndex] = useState(null)
  const [damageFlash, setDamageFlash] = useState(false)
  const [battleEvents, setBattleEvents] = useState([])
  // Список активных damage-маркеров (над картами)
  const [damageMarkers, setDamageMarkers] = useState([])
  // Список «мигающих» карточек (для эмиссии красного цвета)
  const [damageFlashCards, setDamageFlashCards] = useState({})
  // Состояние модалки действий над картой на земле
  const [zoneCardActionMenu, setZoneCardActionMenu] = useState(null) // { playerId, zoneIndex, card }

  // === Refs ===
  const boardRef = useRef(null)
  const pointerRef = useRef({ x: 0, y: 0 })
  const placingLockRef = useRef(false)
  const cardIndexRef = useRef(null)
  const controlsRef = useRef(null)

  useEffect(() => {
    cardIndexRef.current = draggingCardIndex ?? selectedCardIndex
  }, [draggingCardIndex, selectedCardIndex])

  // === Derived state ===
  const players = useMemo(() => safePlayers(game.players), [game.players])
  const playerCount = players.length
  const myIndex = useMemo(() => {
    const idx = players.findIndex((p) => p.player_id === playerId)
    return idx === -1 && players.length > 0 ? 0 : idx
  }, [players, playerId])

  const me = useMemo(
    () => (myIndex >= 0 ? safePlayer(players, players[myIndex]?.player_id) : safePlayer([], null)),
    [players, myIndex],
  )

  // Dedup handCards по instanceId/id — чтобы не было ghost-карт и duplicate keys
  // когда WS-push и локальный optimistic reload временно дают два вхождения.
  const handCards = useMemo(() => {
    const raw = Array.isArray(me?.hand) ? me.hand : []
    const seen = new Set()
    const out = []
    for (const c of raw) {
      if (!c) continue
      const id = c.instanceId || c.id
      if (id && seen.has(id)) continue
      if (id) seen.add(id)
      out.push(c)
    }
    return out
  }, [me])
  const isYourTurn = game.current_player_id === playerId
  const isFinished = game.status === 'finished'
  const inSetup = game.status === 'setup'

  const actionsRemaining = isYourTurn
    ? (me?.actions_remaining ?? game.actions_remaining ?? 2)
    : 0
  const aliveCount = useMemo(
    () => players.filter((p) => (p.health ?? 0) > 0).length,
    [players],
  )
  const canDealDamage = canPlayerDealDamage(
    me?.player_order,
    aliveCount,
    game.current_turn ?? 0,
  )

  const activeCard = useMemo(() => {
    const idx = draggingCardIndex ?? selectedCardIndex
    return idx !== null ? handCards[idx] ?? null : null
  }, [draggingCardIndex, selectedCardIndex, handCards])

  // === Position calculations ===
  const zones = useMemo(() => buildBoardZones(players, myIndex), [players, myIndex])
  const zoneCards = useStableZoneCards(players)
  const getZoneSplit = useCallback(
    (playerId, zoneIndex) => {
      return zoneCards.get(`${playerId}:${zoneIndex}`) ?? { creatureCard: null, buildingCard: null }
    },
    [zoneCards],
  )

  const resolveLandType = useCallback(
    (zoneRow) => {
      if (zoneRow?.land_type) return zoneRow.land_type
      const id = zoneRow?.land_id
      if (id && landCatalog[id]?.land_type) return landCatalog[id].land_type
      return null
    },
    [landCatalog],
  )

  // === Pointer tracking ===
  const updatePointer = useCallback((clientX, clientY) => {
    const el = boardRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    pointerRef.current = {
      x: ((clientX - rect.left) / rect.width) * 2 - 1,
      y: -((clientY - rect.top) / rect.height) * 2 + 1,
    }
  }, [])

  useEffect(() => {
    const onMove = (e) => updatePointer(e.clientX, e.clientY)
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [updatePointer])

  // === Actions ===
  const handlePointerMissed = useCallback(() => {
    setSelectedZoneIndex(null)
  }, [])

  const handleLandClick = useCallback(
    (zone) => {
      if (!zone.isOwnerMe || activeCard) return
      setSelectedZoneIndex(zone.zoneIndex === selectedZoneIndex ? null : zone.zoneIndex)
    },
    [activeCard, selectedZoneIndex],
  )

  const handleZoneCardClick = useCallback(
    (zone, card) => {
      if (inSetup || !isYourTurn || isFinished || !zone.isOwnerMe) return
      toast('info', `Действие с картой: ${card?.name ?? '?'}`)
    },
    [inSetup, isYourTurn, isFinished, toast],
  )

  const handleConfirmLandSetup = useCallback(
    async ({ landIds = [], bypass = false } = {}) => {
      try {
        await onConfirmLandSetup?.({ landIds, bypass })
      } catch (e) {
        toast('error', e?.message || 'Не удалось подтвердить расстановку')
      }
    },
    [onConfirmLandSetup, toast],
  )

  const handleSkipLandSetup = useCallback(async () => {
    try {
      await onSkipLandSetup?.()
    } catch (e) {
      toast('error', e?.message || 'Не удалось пропустить расстановку')
    }
  }, [onSkipLandSetup, toast])

  const handleRayRelease = useCallback(
    async (cardIdx, target) => {
      if (placingLockRef.current) return
      const card = handCards[cardIdx]
      if (!card || !target) return

      placingLockRef.current = true
      setDraggingCardIndex(null)
      onSuppressRealtimeReload?.(5000)
      try {
        const result = await onPlayCard?.(cardIdx, target.zoneIndex, 1, target.slotType)
        if (result?.error) {
          toast('error', result.error)
          return
        }
        setSelectedCardIndex(null)
      } catch (err) {
        toast('error', err?.message || 'Не удалось сыграть карту')
      } finally {
        placingLockRef.current = false
      }
    },
    [handCards, toast, onSuppressRealtimeReload, onPlayCard],
  )

  /**
   * Запустить визуальный эффект «урона» по карте на поле:
   * - число урона всплывает над зоной
   * - карточка вспыхивает красным (damageFlash=true через GameObject)
   * - через 1.5с всё очищается
   */
  const triggerDamageVisual = useCallback(({ markers, flashedCards = {} }) => {
    if (Array.isArray(markers) && markers.length > 0) {
      setDamageMarkers((prev) => [...prev, ...markers])
      // чистка через 1.5с
      setTimeout(() => {
        setDamageMarkers((prev) => prev.filter((m) => !markers.some((nm) => nm.key === m.key)))
      }, 1500)
    }
    if (Object.keys(flashedCards).length > 0) {
      setDamageFlashCards((prev) => ({ ...prev, ...flashedCards }))
      // снимаем флэш через 0.6с
      setTimeout(() => {
        setDamageFlashCards((prev) => {
          const next = { ...prev }
          for (const k of Object.keys(flashedCards)) delete next[k]
          return next
        })
      }, 650)
    }
  }, [])

  const handleEndTurn = useCallback(async () => {
    onSuppressRealtimeReload?.(8000)
    const result = await onEndTurn?.()
    if (result?.error) {
      toast('error', result.error)
      return result
    }
    setSelectedCardIndex(null)
    setSelectedZoneIndex(null)
    setDraggingCardIndex(null)

    const events = result?.battleEvents
    if (Array.isArray(events) && events.length > 0) {
      setBattleEvents((prev) => [...prev, ...events])
      const { markers, flashMe } = battleEventsToVisuals(events, playerId)
      triggerDamageVisual({ markers })
      if (flashMe) {
        setDamageFlash(true)
        setTimeout(() => setDamageFlash(false), 550)
      }
    }
    return result
  }, [onEndTurn, onSuppressRealtimeReload, playerId, toast, triggerDamageVisual])

  return (
    <div
      ref={boardRef}
      className="game-board-3d"
      onPointerDown={(e) => updatePointer(e.clientX, e.clientY)}
    >
      <GameCanvas
        shadows={shadowsEnabled}
        onPointerMissed={handlePointerMissed}
        onToastError={(msg) => toast('error', msg)}
      >
        <GameExperience
          playerIndex={myIndex >= 0 ? myIndex : 0}
          playerCount={playerCount}
          controlsRef={controlsRef}
        >
          {zones.map((zone) => {
            const zoneRows = normalizePlayerZoneRows(zone.player.zones)
            const row = zoneRows[zone.zoneIndex] || {}
            const { creatureCard, buildingCard } = getZoneSplit(
              zone.player.player_id,
              zone.zoneIndex,
            )
            const isSelectedZone =
              zone.isOwnerMe && selectedZoneIndex === zone.zoneIndex
            const slots = getLandSlotLayout()

            return (
              <group
                key={`zone-${zone.player.player_id}-${zone.zoneIndex}`}
                position={zone.center}
                rotation={[0, zone.rotationY, 0]}
              >
                <GameLand
                  landType={resolveLandType(row)}
                  selected={isSelectedZone}
                  onClick={() => handleLandClick(zone)}
                  creaturePlayable={
                    zone.isOwnerMe && isYourTurn && !inSetup && !isFinished && Boolean(activeCard)
                  }
                  buildingPlayable={
                    zone.isOwnerMe && isYourTurn && !inSetup && !isFinished && Boolean(activeCard)
                  }
                  onCreatureClick={() => {
                    if (zone.isOwnerMe && activeCard) {
                      handleRayRelease(cardIndexRef.current ?? 0, {
                        zoneIndex: zone.zoneIndex,
                        slotType: 'creature',
                      })
                    }
                  }}
                  onBuildingClick={() => {
                    if (zone.isOwnerMe && activeCard) {
                      handleRayRelease(cardIndexRef.current ?? 0, {
                        zoneIndex: zone.zoneIndex,
                        slotType: 'building',
                      })
                    }
                  }}
                />

                {/* Существо лежит в creature-слоте (z<0, дальняя половина) */}
                {creatureCard && (
                  <GameObject
                    key={makeCardKey(creatureCard, { slot: 'creature', zoneIndex: zone.zoneIndex })}
                    card={creatureCard}
                    type={CARD_OBJECT_TYPES.CREATURE}
                    position={[slots.creature.x, PLAY_FIELD_Y + 0.004, slots.creature.z]}
                    rotation={[-Math.PI / 2, 0, 0]}
                    flatOnTable
                    tableScale={FIELD_CARD_SCALE}
                    isSelected={isSelectedZone}
                    isFaceUp
                    showStats
                    damageFlash={Boolean(damageFlashCards[`${zone.player.player_id}-${zone.zoneIndex}`])}
                    showFlipOption={Boolean(zone.isOwnerMe && isYourTurn)}
                    onClick={() => {
                      if (zone.isOwnerMe && isYourTurn) {
                        setZoneCardActionMenu({
                          playerId: zone.player.player_id,
                          zoneIndex: zone.zoneIndex,
                          card: creatureCard,
                          slotType: 'creature',
                        })
                      } else {
                        handleZoneCardClick(zone, creatureCard)
                      }
                    }}
                  />
                )}

                {/* Строение лежит в building-слоте (z>0, ближняя половина) */}
                {buildingCard && (
                  <GameObject
                    key={makeCardKey(buildingCard, { slot: 'building', zoneIndex: zone.zoneIndex })}
                    card={buildingCard}
                    type={CARD_OBJECT_TYPES.BUILDING}
                    position={[slots.building.x, PLAY_FIELD_Y + 0.004, slots.building.z]}
                    rotation={[-Math.PI / 2, 0, 0]}
                    flatOnTable
                    tableScale={FIELD_CARD_SCALE}
                    isSelected={false}
                    isFaceUp
                    showStats
                    damageFlash={Boolean(damageFlashCards[`${zone.player.player_id}-${zone.zoneIndex}`])}
                    onClick={() => {
                      if (zone.isOwnerMe && isYourTurn) {
                        setZoneCardActionMenu({
                          playerId: zone.player.player_id,
                          zoneIndex: zone.zoneIndex,
                          card: buildingCard,
                          slotType: 'building',
                        })
                      } else {
                        handleZoneCardClick(zone, buildingCard)
                      }
                    }}
                  />
                )}
              </group>
            )
          })}

          {/* Ники игроков над зонами */}
          <PlayerNameLabels
            players={players}
            playerCount={playerCount}
            currentPlayerId={game.current_player_id}
          />

          {/* Числа урона над картами — всплывают и угасают */}
          {damageMarkers.map((m) => {
            const targetZone = zones.find(
              (z) => z.player.player_id === m.playerId && z.zoneIndex === m.zoneIndex,
            )
            if (!targetZone) return null
            const { center } = targetZone
            return (
              <GameDamageFloater
                key={m.key}
                markerKeys={[m.key]}
                amount={m.amount}
                position={[center[0], PLAY_FIELD_Y + 0.45, center[2]]}
              />
            )
          })}
        </GameExperience>
      </GameCanvas>

      {game.status === 'setup' && (
        <LandSetupOverlay
          game={game}
          playerId={playerId}
          landCatalog={landCatalog}
          onReorder={async (landIds) => {
            try {
              await onReorderLands?.(landIds)
            } catch (e) {
              toast('error', e?.message || 'Не удалось переставить земли')
            }
          }}
          onConfirm={handleConfirmLandSetup}
          onSkip={handleSkipLandSetup}
          isApplying={isApplying}
        />
      )}

      <DamageFlashOverlay active={damageFlash} />

      {zoneCardActionMenu && (
        <ZoneCardActionMenu
          card={zoneCardActionMenu.card}
          onFlip={async () => {
            const cardId = zoneCardActionMenu.card?.id ?? zoneCardActionMenu.card?.instanceId
            await onFlipCard?.(zoneCardActionMenu.playerId, zoneCardActionMenu.zoneIndex, cardId)
            setZoneCardActionMenu(null)
          }}
          onDiscard={async () => {
            const cardId = zoneCardActionMenu.card?.id ?? zoneCardActionMenu.card?.instanceId
            await onDiscardFromZone?.(zoneCardActionMenu.zoneIndex, cardId)
            setZoneCardActionMenu(null)
          }}
          onClose={() => setZoneCardActionMenu(null)}
        />
      )}

      <GamePanel
        playerId={playerId}
        isYourTurn={isYourTurn && game.status !== 'setup'}
        isFinished={isFinished}
        winnerId={game.winner_id}
        me={me}
        players={players}
        handCards={handCards}
        actionsRemaining={actionsRemaining}
        canDealDamage={canDealDamage}
        log={game.game_state?.log || []}
        battleEvents={battleEvents}
        onEndTurn={handleEndTurn}
        onForfeit={onForfeit}
        onDrawFreeCard={onDrawFreeCard}
        onDrawPaidCard={onDrawPaidCard}
        onShuffleDeck={onShuffleDeck}
        onDiscardFromHand={onDiscardFromHand}
        onGameEnd={onGameEnd}
        realtimeStatus={realtimeStatus}
        playerCount={playerCount}
        myIndex={myIndex}
        selectedCardIndex={selectedCardIndex}
        setSelectedCardIndex={setSelectedCardIndex}
        isApplying={isApplying}
        actionError={actionError}
        draggingCardIndex={draggingCardIndex}
        setDraggingCardIndex={setDraggingCardIndex}
        updatePointer={updatePointer}
      />
    </div>
  )
}

/**
 * GameBoard3D с memo: предотвращает полный ремонт 3D-сцены когда меняются
 * пропсы которые не влияют на 3D (toast, realtimeStatus, isApplying и т.п.).
 * Memo пропускает ре-рендер если game.version не изменился.
 */
function gamesEqual(a, b) {
  if (a === b) return true
  if (!a || !b) return false
  if (a.version !== b.version) return false
  if (a.status !== b.status) return false
  if (a.current_player_id !== b.current_player_id) return false
  if (a.current_turn !== b.current_turn) return false
  if (a.winner_id !== b.winner_id) return false
  if (a.actions_remaining !== b.actions_remaining) return false
  const aPlayers = Array.isArray(a.players) ? a.players : []
  const bPlayers = Array.isArray(b.players) ? b.players : []
  if (aPlayers.length !== bPlayers.length) return false
  for (let i = 0; i < aPlayers.length; i++) {
    const ap = aPlayers[i] || {}
    const bp = bPlayers[i] || {}
    if (ap.player_id !== bp.player_id) return false
    if (ap.health !== bp.health) return false
    if (ap.actions_remaining !== bp.actions_remaining) return false
    if (ap.hand_count !== bp.hand_count) return false
    // hand: пересоздаётся каждый раз — проверяем только длину
    const ah = Array.isArray(ap.hand) ? ap.hand.length : 0
    const bh = Array.isArray(bp.hand) ? bp.hand.length : 0
    if (ah !== bh) return false
  }
  return true
}

function gameBoard3DAreEqual(prev, next) {
  return (
    gamesEqual(prev.game, next.game) &&
    prev.playerId === next.playerId &&
    prev.landCatalog === next.landCatalog &&
    prev.realtimeStatus === next.realtimeStatus &&
    prev.isApplying === next.isApplying &&
    prev.actionError === next.actionError
  )
}

export default memo(GameBoard3D, gameBoard3DAreEqual)