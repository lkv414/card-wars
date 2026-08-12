import React, { useMemo, useCallback, useState, useRef } from 'react'
import { safePlayers, safePlayer } from '../../../utils/safePlayer'
import { hasFlipAbility } from '../../../hooks/game'
import { normalizePlayerZoneRows, normalizeZoneCards } from '../../../hooks/game/format'
import {
  canPlayCardToSlot,
  getCardSlotType,
  SLOT_BUILDING,
  SLOT_CREATURE,
  splitZoneCards,
} from '../../../hooks/game/zoneCards'
import { calculatePlayerSlotPositions, calculateTwoPlayerBoard, ownerRotationY } from './layout'
import { TableDecor } from './TableDecor'
import { ZoneColumn } from './ZoneColumn'
import { SceneLighting } from './SceneLighting'
import { PlacementRaycaster } from './PlacementRaycaster'
import { PlacementPointerRelease } from './PlacementPointerRelease'

export function GameScene({
  game,
  playerId,
  landCatalog = {},
  onPlayCard,
  onFlipCard,
  onDiscardFromZone,
  onRequestZoneAction,
  damageMarkers = [],
  selectedCardIndex,
  setSelectedCardIndex,
  selectedZoneIndex,
  setSelectedZoneIndex,
  draggingCardIndex = null,
  setDraggingCardIndex,
  handCards = [],
  pointerRef,
  rayTargetRef,
  placingLockRef,
  isPlacementActive = false,
  boardRectRef,
  cardIndexRef,
  onRayRelease,
}) {
  const [rayTarget, setRayTarget] = useState(null)
  const players = useMemo(() => safePlayers(game.players), [game.players])
  const playerCount = players.length
  let myIndex = players.findIndex((p) => p.player_id === playerId)
  if (myIndex === -1 && players.length > 0) myIndex = 0

  const me = myIndex >= 0 ? safePlayer(players, players[myIndex]?.player_id) : safePlayer([], null)
  const isYourTurn = game.current_player_id === playerId
  const isFinished = game.status === 'finished'
  const inSetup = game.status === 'setup'

  const activeCard = useMemo(() => {
    if (draggingCardIndex !== null && handCards[draggingCardIndex]) {
      return handCards[draggingCardIndex]
    }
    if (selectedCardIndex !== null && handCards[selectedCardIndex]) {
      return handCards[selectedCardIndex]
    }
    return null
  }, [draggingCardIndex, selectedCardIndex, handCards])

  const handleRayTargetChange = useCallback(
    (target) => {
      setRayTarget(target)
      if (rayTargetRef) rayTargetRef.current = target
    },
    [rayTargetRef]
  )

  const sharedLanes = useMemo(
    () => (playerCount === 2 ? calculateTwoPlayerBoard(myIndex) : null),
    [myIndex, playerCount]
  )

  const mySlotPositions = useMemo(
    () => (playerCount !== 2 ? calculatePlayerSlotPositions(myIndex, playerCount) : []),
    [myIndex, playerCount]
  )

  const opponentSlotPositions = useMemo(() => {
    if (playerCount === 2) return []
    const opponents = []
    for (let i = 0; i < playerCount; i++) {
      if (i !== myIndex) {
        opponents.push({ index: i, positions: calculatePlayerSlotPositions(i, playerCount) })
      }
    }
    return opponents
  }, [playerCount, myIndex])

  const resolveLandType = useCallback(
    (zoneRow) => {
      if (zoneRow?.land_type) return zoneRow.land_type
      const id = zoneRow?.land_id
      if (id && landCatalog[id]?.land_type) return landCatalog[id].land_type
      return null
    },
    [landCatalog]
  )

  const playToSlot = useCallback(
    async (zoneIndex, slotType) => {
      if (placingLockRef?.current) return false
      const cardIdx = draggingCardIndex ?? selectedCardIndex
      if (cardIdx === null || !activeCard) return false
      if (getCardSlotType(activeCard) !== slotType) return false

      const zoneRows = normalizePlayerZoneRows(me.zones)
      const cards = normalizeZoneCards(zoneRows[zoneIndex])
      if (!canPlayCardToSlot(cards, activeCard)) return false

      if (placingLockRef) placingLockRef.current = true
      setSelectedCardIndex(null)
      setDraggingCardIndex?.(null)
      setRayTarget(null)
      if (rayTargetRef) rayTargetRef.current = null

      try {
        await onPlayCard(cardIdx, zoneIndex, 1, slotType)
      } catch (e) {
        console.error('Play card failed:', e)
        return false
      } finally {
        if (placingLockRef) placingLockRef.current = false
        setSelectedZoneIndex(null)
      }
      return true
    },
    [
      draggingCardIndex,
      selectedCardIndex,
      activeCard,
      me.zones,
      onPlayCard,
      setSelectedCardIndex,
      setDraggingCardIndex,
      setSelectedZoneIndex,
      rayTargetRef,
      placingLockRef,
    ]
  )

  const playToSlotRef = useRef(playToSlot)
  playToSlotRef.current = playToSlot

  React.useEffect(() => {
    if (!isPlacementActive) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setSelectedCardIndex(null)
        setRayTarget(null)
        if (rayTargetRef) rayTargetRef.current = null
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isPlacementActive, setSelectedCardIndex, rayTargetRef])

  const getZoneDamage = useCallback(
    (ownerId, zoneIndex) => {
      const hit = damageMarkers.find(
        (m) => m.playerId === ownerId && m.zoneIndex === zoneIndex
      )
      return hit?.amount ?? null
    },
    [damageMarkers]
  )

  const handleZoneCardClick = useCallback(
    (playerIndex, zoneIndex, card) => {
      if (inSetup || !isYourTurn || isFinished || playerIndex !== myIndex) return
      onRequestZoneAction?.({ playerIndex, zoneIndex, card, canFlip: hasFlipAbility(card) })
    },
    [inSetup, isYourTurn, isFinished, myIndex, onRequestZoneAction]
  )

  const renderZoneColumn = (player, playerIndex, half, isOwnerMe) => {
    const zoneRows = normalizePlayerZoneRows(player.zones)
    const zoneIndex = half?.zoneIndex ?? half
    const row = zoneRows[zoneIndex] || {}
    const cards = normalizeZoneCards(row)
    const isSelectedZone = isOwnerMe && selectedZoneIndex === zoneIndex

    const creaturePlayable =
      isOwnerMe && isYourTurn && !inSetup && !isFinished && activeCard
        ? getCardSlotType(activeCard) === SLOT_CREATURE && canPlayCardToSlot(cards, activeCard)
        : false
    const buildingPlayable =
      isOwnerMe && isYourTurn && !inSetup && !isFinished && activeCard
        ? getCardSlotType(activeCard) === SLOT_BUILDING && canPlayCardToSlot(cards, activeCard)
        : false

    const center = half?.center ?? half.center
    const rotationY = half?.rotationY ?? half.rotationY ?? ownerRotationY(playerIndex, playerCount)

    const { creatureCard } = splitZoneCards(cards)
    const damageAmount = getZoneDamage(player.player_id, zoneIndex)

    return (
      <ZoneColumn
        key={`p${player.player_id}-z${zoneIndex}-${isOwnerMe ? 'mine' : 'opp'}`}
        center={center}
        rotationY={rotationY}
        zoneIndex={zoneIndex}
        landType={resolveLandType(row)}
        cards={cards}
        isOwnerMe={isOwnerMe}
        isSelected={isSelectedZone}
        isMyTurn={isYourTurn}
        damageAmount={damageAmount}
        creaturePlayable={creaturePlayable}
        buildingPlayable={buildingPlayable}
        creatureRayHover={rayTarget?.zoneIndex === zoneIndex && rayTarget?.slotType === SLOT_CREATURE}
        buildingRayHover={rayTarget?.zoneIndex === zoneIndex && rayTarget?.slotType === SLOT_BUILDING}
        onCreatureSlotClick={
          isOwnerMe ? () => playToSlotRef.current(zoneIndex, SLOT_CREATURE) : undefined
        }
        onBuildingSlotClick={
          isOwnerMe ? () => playToSlotRef.current(zoneIndex, SLOT_BUILDING) : undefined
        }
        onZoneCardClick={(card) => handleZoneCardClick(playerIndex, zoneIndex, card)}
      />
    )
  }

  const renderPlayerColumns = (player, slotPositions, playerIndex, isOwnerMe) =>
    slotPositions.map((slot) => renderZoneColumn(player, playerIndex, slot, isOwnerMe))

  const renderTwoPlayerLanes = () => {
    if (!sharedLanes) return null
    return sharedLanes.map((lane) => {
      const nearPlayer = safePlayer(players, players[lane.near.playerIndex]?.player_id)
      const farPlayer = safePlayer(players, players[lane.far.playerIndex]?.player_id)
      return (
        <React.Fragment key={`lane-${lane.laneIndex}`}>
          {farPlayer && !farPlayer.__isFallback && renderZoneColumn(farPlayer, lane.far.playerIndex, lane.far, false)}
          {nearPlayer && !nearPlayer.__isFallback && renderZoneColumn(nearPlayer, lane.near.playerIndex, lane.near, true)}
        </React.Fragment>
      )
    })
  }

  return (
    <>
      <SceneLighting />

      <TableDecor playerCount={playerCount} />

      {playerCount === 2 ? (
        renderTwoPlayerLanes()
      ) : (
        <>
          {opponentSlotPositions.map((opp) => {
            const opponent = safePlayer(players, players[opp.index]?.player_id)
            if (!opponent || opponent.__isFallback) return null
            return (
              <React.Fragment key={`player-${opp.index}`}>
                {renderPlayerColumns(opponent, opp.positions, opp.index, false)}
              </React.Fragment>
            )
          })}
          {renderPlayerColumns(me, mySlotPositions, myIndex, true)}
        </>
      )}

      <PlacementRaycaster
        active={isPlacementActive && Boolean(activeCard)}
        pointerRef={pointerRef}
        onTargetChange={handleRayTargetChange}
      />

      <PlacementPointerRelease
        active={isPlacementActive && Boolean(activeCard)}
        pointerRef={pointerRef}
        boardRectRef={boardRectRef}
        cardIndexRef={cardIndexRef}
        onRelease={onRayRelease}
      />
    </>
  )
}
