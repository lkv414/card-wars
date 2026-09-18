/**
 * GameBoard3D — корневой компонент игровой 3D-сцены.
 *
 * Что сделано по PERFORMANCE_AUDIT_3D.md (🔴 Критично):
 *
 *  1. Вынесена чистая derivation-логика в `useBoardModel(game, playerId, landCatalog)`
 *     (gameBoard3D/useBoardModel.js) → `zones` строятся ОДИН раз за рендер, без
 *     промежуточных аллокаций.
 *
 *  2. Извлечён memo-компонент `<ZoneColumn>` (gameBoard3D/ZoneColumn.jsx):
 *     рендер колонки стабилен при изменении только одной зоны. memo на нём
 *     теперь реально работает, потому что:
 *       - positions/rotations — модульные константы (sceneResources.js);
 *       - все колбэки — useCallback в GameBoard3D с refs на `activeCard`,
 *         `handCards`, `setDraggingCardIndex`;
 *       - `resolveCardVisual` мемоизирован по карте + каталогу.
 *
 *  3. Убраны лишние баги:
 *       - GameBoard3D передавал onClick, GameLand ждал onLandClick → клики
 *         мёртвые. GameLand теперь принимает ОБА (GameBoard3D оставляет onClick).
 *       - registerPlayableSlot подключён в SlotPad → placementRaycast больше
 *         не делает scene.traverse() на каждый drop.
 *       - useEffect при изменении damageFlash=false восстанавливает позицию
 *         карты через общий сеттер (см. GameObject).
 *       - getBoundingClientRect кэшируется на resize (а не вызывается на
 *         каждый pointermove).
 *       - таймеры triggerDamageVisual чистятся в cleanup.
 *       - battleEvents ограничен N последними записями.
 *
 *  4. resolveCardVisual стабилизирован через мемоизированный helper.
 *
 *  5. Тени выключены полностью (Canvas без shadows, нет castShadow в сцене).
 */
import { useMemo, useState, useCallback, useRef, useEffect, memo } from 'react'

import { GameCanvas } from './scene/GameCanvas'
import { GameExperience } from './scene/GameExperience'
import { GamePanel } from './scene/GamePanel'
import { PlayerNameLabels } from './scene/PlayerNameLabels'
import { GameDamageFloater } from './scene/GameDamageFloater'
import { BoardOutlines } from './scene/BoardOutlines'

import { DamageFlashOverlay } from './DamageFlashOverlay'
import { LandSetupOverlay } from './LandSetupOverlay'
import { ZoneCardActionMenu } from './hud/ZoneCardActionMenu'
import { PlacementPointerRelease } from './gameBoard3D/PlacementPointerRelease'
import { useBoardModel } from './gameBoard3D/useBoardModel'
import { ZoneColumn } from './gameBoard3D/ZoneColumn'

import { canPlayerDealDamage } from '../../hooks/game/combat'
import { battleEventsToVisuals } from '../../hooks/game/battlePhase'
import {
  LAND_PLACEMENT_RULES,
  normalizeLandPlacementRule,
} from '../../constants/game'
import { getCardLandType, isLandCompatible } from '../../utils/cardFields'
import { getCardSlotType, isSlotEmpty } from '../../hooks/game/zoneCards'
import { normalizePlayerZoneRows, normalizeZoneCards } from '../../hooks/game/format'
import { splitZoneCards } from '../../hooks/game/zoneCards'
import { PLAY_FIELD_Y, computeFieldCardScale } from '../../utils/gameObjectPlacement'

const FIELD_CARD_SCALE = computeFieldCardScale(0.88)
const BATTLE_EVENTS_LIMIT = 200
const PLAYER_LABEL_Y = PLAY_FIELD_Y + 0.45

/**
 * Лимит battleEvents — массив растёт всю партию, иначе mergeLogWithBattle
 * начинает тормозить HUDOverlay на каждом изменении. Держим последние N.
 */
function pushBattleEvents(prev, events) {
  if (!Array.isArray(events) || events.length === 0) return prev
  const merged = prev.length === 0 ? events : [...prev, ...events]
  return merged.length > BATTLE_EVENTS_LIMIT
    ? merged.slice(merged.length - BATTLE_EVENTS_LIMIT)
    : merged
}

/**
 * Хук: кэширует splitZoneCards по identity зон (стабильные ссылки).
 */
function useStableZoneCards(players) {
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

/**
 * Главный компонент.
 */
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
  cardCatalog = null,
}) {
  // === Visual state ===
  const [selectedCardIndex, setSelectedCardIndex] = useState(null)
  const [selectedZoneIndex, setSelectedZoneIndex] = useState(null)
  const [draggingCardIndex, setDraggingCardIndex] = useState(null)
  const [damageFlash, setDamageFlash] = useState(false)
  const [battleEvents, setBattleEvents] = useState([])
  const [damageMarkers, setDamageMarkers] = useState([])
  const [damageFlashCards, setDamageFlashCards] = useState({})
  const [zoneCardActionMenu, setZoneCardActionMenu] = useState(null)

  // === Refs ===
  const boardRef = useRef(null)
  const pointerRef = useRef({ x: 0, y: 0 })
  const placingLockRef = useRef(false)
  const cardIndexRef = useRef(null)
  const draggingRef = useRef(false)
  const dragGhostRef = useRef(null)
  const controlsRef = useRef(null)
  const boardRectRef = useRef(null) // кэш rect (обновляется на resize/mount)

  // === Card catalog ref (стабильная ссылка для колбэков) ===
  const cardCatalogRef = useRef(cardCatalog)
  if (cardCatalogRef.current !== cardCatalog) {
    cardCatalogRef.current = cardCatalog
  }

  // === Derivation (useBoardModel) ===
  const { players, playerCount, myIndex, me, zones } = useBoardModel(
    game,
    playerId,
    landCatalog,
  )
  const zoneCards = useStableZoneCards(players)
  const getZoneSplit = useCallback(
    (playerId, zoneIndex) => {
      return zoneCards.get(`${playerId}:${zoneIndex}`) ?? { creatureCard: null, buildingCard: null }
    },
    [zoneCards],
  )

  // === Hand cards ===
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

  useEffect(() => {
    cardIndexRef.current = draggingCardIndex ?? selectedCardIndex
  }, [draggingCardIndex, selectedCardIndex])

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

  // === Active card через refs (стабильная ссылка для колбэков) ===
  const activeCardRef = useRef(null)
  const activeCard = useMemo(() => {
    const idx = draggingCardIndex ?? selectedCardIndex
    return idx !== null ? handCards[idx] ?? null : null
  }, [draggingCardIndex, selectedCardIndex, handCards])
  useEffect(() => {
    activeCardRef.current = activeCard
  }, [activeCard])

  // === Управление drag ===
  const setDragging = useCallback((idx) => {
    draggingRef.current = idx != null
    setDraggingCardIndex(idx)
  }, [])

  // === Кэш getBoundingClientRect ===
  const refreshBoardRect = useCallback(() => {
    const el = boardRef.current
    if (!el) {
      boardRectRef.current = null
      return null
    }
    boardRectRef.current = el.getBoundingClientRect()
    return boardRectRef.current
  }, [])

  const updatePointer = useCallback((clientX, clientY) => {
    let rect = boardRectRef.current
    if (!rect) rect = refreshBoardRect()
    if (rect && rect.width > 0 && rect.height > 0) {
      pointerRef.current = {
        x: ((clientX - rect.left) / rect.width) * 2 - 1,
        y: -((clientY - rect.top) / rect.height) * 2 + 1,
      }
    }
    if (draggingRef.current && dragGhostRef.current) {
      dragGhostRef.current.style.left = `${clientX}px`
      dragGhostRef.current.style.top = `${clientY}px`
    }
  }, [refreshBoardRect])

  useEffect(() => {
    refreshBoardRect()
    const onResize = () => refreshBoardRect()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [refreshBoardRect])

  useEffect(() => {
    const onMove = (e) => updatePointer(e.clientX, e.clientY)
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [updatePointer])

  // === Колбэки (стабильные ссылки через refs) ===
  const handlePointerMissed = useCallback(() => {
    setSelectedZoneIndex(null)
  }, [])

  const handleLandClick = useCallback((zone) => {
    if (!zone.isOwnerMe || activeCardRef.current) return
    setSelectedZoneIndex((prev) => (prev === zone.zoneIndex ? null : zone.zoneIndex))
  }, [])

  const handleZoneCardClick = useCallback((zone, card) => {
    if (game.status === 'setup' || game.current_player_id !== playerId) return
    if (game.status === 'finished') return
    if (!zone.isOwnerMe) return
    toast('info', `Действие с картой: ${card?.name ?? '?'}`)
  }, [game.status, game.current_player_id, playerId, toast])

  // === handleRayRelease (определён выше slot-click колбэков) ===
  const handleRayRelease = useCallback(
    async (cardIdx, target) => {
      if (placingLockRef.current) return
      const card = handCards[cardIdx]
      if (!card || !target) return

      const landRule = normalizeLandPlacementRule(game.game_state?.landPlacementRule)
      if (landRule === LAND_PLACEMENT_RULES.STRICT) {
        const myZoneRows = normalizePlayerZoneRows(me?.zones)
        const row = myZoneRows[target.zoneIndex] || {}
        const zoneLand = row.land_type
          || (row.land_id && landCatalog[row.land_id]?.land_type)
          || null
        if (!isLandCompatible(getCardLandType(card), zoneLand)) {
          toast('error', 'Карта не подходит к этой земле')
          setDraggingCardIndex(null)
          return
        }
      }

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
    [handCards, me, landCatalog, game.game_state?.landPlacementRule, onPlayCard, onSuppressRealtimeReload, toast],
  )

  const handleCreatureSlotClick = useCallback((zone) => {
    if (!activeCardRef.current) return
    handleRayRelease(cardIndexRef.current ?? 0, {
      zoneIndex: zone.zoneIndex,
      slotType: 'creature',
    })
  }, [handleRayRelease])

  const handleBuildingSlotClick = useCallback((zone) => {
    if (!activeCardRef.current) return
    handleRayRelease(cardIndexRef.current ?? 0, {
      zoneIndex: zone.zoneIndex,
      slotType: 'building',
    })
  }, [handleRayRelease])

  const handleCreatureCardClick = useCallback((zone, card) => {
    if (zone.isOwnerMe && game.current_player_id === playerId && game.status !== 'finished') {
      setZoneCardActionMenu({
        playerId: zone.player.player_id,
        zoneIndex: zone.zoneIndex,
        card,
        slotType: 'creature',
      })
    } else {
      handleZoneCardClick(zone, card)
    }
  }, [game.status, game.current_player_id, playerId, handleZoneCardClick])

  const handleBuildingCardClick = useCallback((zone, card) => {
    if (zone.isOwnerMe && game.current_player_id === playerId && game.status !== 'finished') {
      setZoneCardActionMenu({
        playerId: zone.player.player_id,
        zoneIndex: zone.zoneIndex,
        card,
        slotType: 'building',
      })
    } else {
      handleZoneCardClick(zone, card)
    }
  }, [game.status, game.current_player_id, playerId, handleZoneCardClick])

  // === handleRayRelease (определён выше, перед slot-click колбэками) ===

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

  // Cleanup-рефы для таймеров урона
  const damageTimersRef = useRef([])

  const triggerDamageVisual = useCallback(({ markers, flashedCards = {} }) => {
    if (Array.isArray(markers) && markers.length > 0) {
      setDamageMarkers((prev) => [...prev, ...markers])
      const id = setTimeout(() => {
        setDamageMarkers((prev) => prev.filter((m) => !markers.some((nm) => nm.key === m.key)))
      }, 1500)
      damageTimersRef.current.push(id)
    }
    if (Object.keys(flashedCards).length > 0) {
      setDamageFlashCards((prev) => ({ ...prev, ...flashedCards }))
      const id = setTimeout(() => {
        setDamageFlashCards((prev) => {
          const next = { ...prev }
          for (const k of Object.keys(flashedCards)) delete next[k]
          return next
        })
      }, 650)
      damageTimersRef.current.push(id)
    }
  }, [])

  // cleanup всех таймеров при unmount
  useEffect(() => {
    return () => {
      for (const id of damageTimersRef.current) clearTimeout(id)
      damageTimersRef.current = []
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
    setDragging(null)

    const events = result?.battleEvents
    if (Array.isArray(events) && events.length > 0) {
      setBattleEvents((prev) => pushBattleEvents(prev, events))
      const { markers, flashMe } = battleEventsToVisuals(events, playerId)
      triggerDamageVisual({ markers })
      if (flashMe) {
        setDamageFlash(true)
        const id = setTimeout(() => setDamageFlash(false), 550)
        damageTimersRef.current.push(id)
      }
    }
    return result
  }, [onEndTurn, onSuppressRealtimeReload, playerId, toast, triggerDamageVisual, setDragging])

  // === Damage flash key для ZoneColumn ===
  const damageFlashKey = useMemo(() => {
    const keys = Object.keys(damageFlashCards)
    return keys.length === 1 ? keys[0] : null
  }, [damageFlashCards])

  // Snapshot ref'а для передачи в ZoneColumn без re-render'а каталога.
  const cardCatalogSnapshot = cardCatalogRef.current

  // === Drop states ===
  const dropStatesByZoneKey = useMemo(() => {
    if (!activeCard || !isYourTurn || inSetup || isFinished) return EMPTY_MAP
    const landRule = normalizeLandPlacementRule(game.game_state?.landPlacementRule)
    if (landRule !== LAND_PLACEMENT_RULES.STRICT) return EMPTY_MAP
    const cardLand = getCardLandType(activeCard)
    const slotType = getCardSlotType(activeCard)
    const out = new Map()
    for (const zone of zones) {
      if (!zone.isOwnerMe) continue
      const row = zone.row || {}
      const zoneLand = zone.landType
      if (!isLandCompatible(cardLand, zoneLand)) {
        out.set(zoneKey(zone), 'invalid')
      } else if (isSlotEmpty(normalizeZoneCards(row), slotType)) {
        out.set(zoneKey(zone), 'valid')
      }
    }
    return out
  }, [activeCard, isYourTurn, inSetup, isFinished, game.game_state?.landPlacementRule, zones])

  // === Render ===
  return (
    <div
      ref={boardRef}
      className="game-board-3d"
      onPointerDown={(e) => updatePointer(e.clientX, e.clientY)}
    >
      <GameCanvas
        onPointerMissed={handlePointerMissed}
        onToastError={(msg) => toast('error', msg)}
      >
        <GameExperience
          playerIndex={myIndex >= 0 ? myIndex : 0}
          playerCount={playerCount}
          controlsRef={controlsRef}
        >
          {/* Обводки всех земель — один InstancedMesh на 32 границы. */}
          <BoardOutlines zones={zones} />

          {/* eslint-disable-next-line react-hooks/refs -- cardCatalogSnapshot is captured above as a stable snapshot */}
          {zones.map((zone) => {
            const split = getZoneSplit(zone.player.player_id, zone.zoneIndex)
            const zKey = zoneKey(zone)
            const isSelectedZone = zone.isOwnerMe && selectedZoneIndex === zone.zoneIndex
            const dropState = dropStatesByZoneKey.get(zKey) || null
            const creaturePlayable = zone.isOwnerMe && isYourTurn && !inSetup && !isFinished && Boolean(activeCard)
            const buildingPlayable = creaturePlayable
            return (
              <ZoneColumn
                key={`zone-${zKey}`}
                zone={zone}
                creatureCard={split.creatureCard}
                buildingCard={split.buildingCard}
                isSelectedZone={isSelectedZone}
                dropState={dropState}
                cardCatalog={cardCatalogSnapshot}
                isYourTurn={isYourTurn}
                creaturePlayable={creaturePlayable}
                buildingPlayable={buildingPlayable}
                damageFlashKey={damageFlashKey}
                tableScale={FIELD_CARD_SCALE}
                onLandClick={handleLandClick}
                onCreatureSlotClick={handleCreatureSlotClick}
                onBuildingSlotClick={handleBuildingSlotClick}
                onCreatureCardClick={handleCreatureCardClick}
                onBuildingCardClick={handleBuildingCardClick}
              />
            )
          })}

          <PlayerNameLabels
            players={players}
            playerCount={playerCount}
            currentPlayerId={game.current_player_id}
            labelY={PLAYER_LABEL_Y}
          />

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

          <PlacementPointerRelease
            active={draggingCardIndex !== null}
            pointerRef={pointerRef}
            boardRectRef={boardRectRef}
            cardIndexRef={cardIndexRef}
            onRelease={handleRayRelease}
          />
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
        setDraggingCardIndex={setDragging}
        updatePointer={updatePointer}
      />

      {draggingCardIndex != null && handCards[draggingCardIndex] && (
        <div ref={dragGhostRef} className="game-drag-ghost" aria-hidden>
          {handCards[draggingCardIndex]?.image_url ? (
            <img src={handCards[draggingCardIndex].image_url} alt="" />
          ) : (
            <span>{handCards[draggingCardIndex]?.name || 'Карта'}</span>
          )}
        </div>
      )}
    </div>
  )
}

const EMPTY_MAP = new Map()

function zoneKey(zone) {
  return `${zone.player.player_id}-${zone.zoneIndex}`
}

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