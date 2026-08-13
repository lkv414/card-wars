import React, { useMemo, useCallback, useState, useRef, memo } from 'react'
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
import { getAttackTargets } from '../../../hooks/game/zoneOpposition'
import { getBattleTargetZone } from '../../../hooks/game/battlePhase'
import { TableDecor } from './TableDecor'
import { ZoneColumn } from './ZoneColumn'
import { SceneLighting } from './SceneLighting'
import { PlacementRaycaster } from './PlacementRaycaster'
import { PlacementPointerRelease } from './PlacementPointerRelease'
import { AttackDirectionHint } from './AttackDirectionHint'
import { PlayerNameLabels } from './PlayerNameLabels'

export const GameScene = memo(function GameScene({
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
      if (i !== myIndex && (players[i]?.health ?? 0) > 0) {
        opponents.push({ index: i, positions: calculatePlayerSlotPositions(i, playerCount) })
      }
    }
    return opponents
  }, [playerCount, myIndex, players])

  const attackTargetZones = useMemo(() => {
    if (selectedZoneIndex == null || !isYourTurn) return new Set()
    const targets = getAttackTargets(playerId, players, selectedZoneIndex)
    const keys = new Set()
    for (const t of targets) {
      for (const z of t.zones) {
        keys.add(`${t.playerId}:${z}`)
      }
    }
    return keys
  }, [selectedZoneIndex, isYourTurn, playerId, players])

  const attackHint = useMemo(() => {
    if (selectedZoneIndex == null || playerCount < 2) return null
    const myPos = playerCount === 2
      ? sharedLanes?.[selectedZoneIndex]?.near?.center
      : mySlotPositions[selectedZoneIndex]?.center
    if (!myPos) return null

    const toZone = getBattleTargetZone(selectedZoneIndex, playerCount)
    const targets = getAttackTargets(playerId, players, selectedZoneIndex)
    if (!targets.length) return null

    let toCenter = null
    if (playerCount === 2 && sharedLanes) {
      toCenter = sharedLanes[toZone]?.far?.center
    } else {
      const oppIdx = players.findIndex((p) => p.player_id === targets[0].playerId)
      if (oppIdx >= 0) {
        const oppPos = calculatePlayerSlotPositions(oppIdx, playerCount)
        toCenter = oppPos[toZone]?.center
      }
    }
    if (!toCenter) return null
    return { from: myPos, to: toCenter }
  }, [selectedZoneIndex, playerCount, sharedLanes, mySlotPositions, playerId, players])

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
      setRayTarget(null)
      if (rayTargetRef) rayTargetRef.current = null

      try {
        const result = await onPlayCard(cardIdx, zoneIndex, 1, slotType)
        if (result?.error) return false
        setSelectedCardIndex(null)
        setDraggingCardIndex?.(null)
        return true
      } catch (e) {
        console.error('Play card failed:', e)
        return false
      } finally {
        if (placingLockRef) placingLockRef.current = false
        setSelectedZoneIndex(null)
      }
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

  const tryPlayToSlot = useCallback(
    (zoneIndex, slotType) => {
      if (draggingCardIndex !== null || placingLockRef?.current) return
      playToSlotRef.current(zoneIndex, slotType)
    },
    [draggingCardIndex, placingLockRef]
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
    const isTargetZone = attackTargetZones.has(`${player.player_id}:${zoneIndex}`)

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
        isAttackTarget={isTargetZone}
        damageAmount={damageAmount}
        creaturePlayable={creaturePlayable}
        buildingPlayable={buildingPlayable}
        creatureRayHover={isOwnerMe && rayTarget?.zoneIndex === zoneIndex && rayTarget?.slotType === SLOT_CREATURE}
        buildingRayHover={isOwnerMe && rayTarget?.zoneIndex === zoneIndex && rayTarget?.slotType === SLOT_BUILDING}
        onCreatureSlotClick={
          isOwnerMe ? () => tryPlayToSlot(zoneIndex, SLOT_CREATURE) : undefined
        }
        onBuildingSlotClick={
          isOwnerMe ? () => tryPlayToSlot(zoneIndex, SLOT_BUILDING) : undefined
        }
        onLandClick={
          isOwnerMe && !activeCard
            ? () => setSelectedZoneIndex(isSelectedZone ? null : zoneIndex)
            : undefined
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
      const farAlive = farPlayer && !farPlayer.__isFallback && (farPlayer.health ?? 0) > 0
      const nearAlive = nearPlayer && !nearPlayer.__isFallback && (nearPlayer.health ?? 0) > 0
      return (
        <React.Fragment key={`lane-${lane.laneIndex}`}>
          {farAlive && renderZoneColumn(farPlayer, lane.far.playerIndex, lane.far, false)}
          {nearAlive && renderZoneColumn(nearPlayer, lane.near.playerIndex, lane.near, true)}
        </React.Fragment>
      )
    })
  }

  return (
    <>
      <SceneLighting />

      <TableDecor playerCount={playerCount} />

      <PlayerNameLabels
        players={players}
        playerCount={playerCount}
        myIndex={myIndex}
        myPlayerId={playerId}
        currentPlayerId={game.current_player_id}
      />

      {playerCount === 2 ? (
        renderTwoPlayerLanes()
      ) : (
        <>
          {opponentSlotPositions.map((opp) => {
            const opponent = safePlayer(players, players[opp.index]?.player_id)
            if (!opponent || opponent.__isFallback || (opponent.health ?? 0) <= 0) return null
            return (
              <React.Fragment key={`player-${opp.index}`}>
                {renderPlayerColumns(opponent, opp.positions, opp.index, false)}
              </React.Fragment>
            )
          })}
          {(me.health ?? 0) > 0 && renderPlayerColumns(me, mySlotPositions, myIndex, true)}
        </>
      )}

      {attackHint && (
        <AttackDirectionHint fromCenter={attackHint.from} toCenter={attackHint.to} />
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
})
