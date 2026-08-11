import React, { useMemo, useCallback } from 'react'
import { safePlayers, safePlayer } from '../../../utils/safePlayer'
import { hasFlipAbility } from '../../../hooks/game'
import { normalizePlayerZones, normalizeZoneCards } from '../../../hooks/game/format'
import {
  calculatePlayerSlotPositions,
  ownerRotationY,
} from './layout'
import { TableDecor } from './TableDecor'
import { BuildingSlot } from './BuildingSlot'
import { EnhancedSlot } from './EnhancedSlot'

export function GameScene({
  game,
  playerId,
  onPlayCard,
  onAttack,
  onFlipCard,
  selectedCardIndex,
  setSelectedCardIndex,
  selectedZoneIndex,
  setSelectedZoneIndex,
}) {
  const players = useMemo(() => safePlayers(game.players), [game.players])
  const playerCount = players.length
  let myIndex = players.findIndex((p) => p.player_id === playerId)
  if (myIndex === -1 && players.length > 0) myIndex = 0

  const me = myIndex >= 0 ? safePlayer(players, players[myIndex]?.player_id) : safePlayer([], null)
  const isYourTurn = game.current_player_id === playerId
  const isFinished = game.status === 'finished'

  const mySlotPositions = useMemo(
    () => calculatePlayerSlotPositions(myIndex, playerCount),
    [myIndex, playerCount]
  )

  const opponentSlotPositions = useMemo(() => {
    const opponents = []
    for (let i = 0; i < playerCount; i++) {
      if (i !== myIndex) {
        opponents.push({ index: i, positions: calculatePlayerSlotPositions(i, playerCount) })
      }
    }
    return opponents
  }, [playerCount, myIndex])

  const handleLandClick = useCallback(
    async (zoneIndex) => {
      if (!isYourTurn || isFinished || selectedCardIndex === null) return
      try {
        await onPlayCard(selectedCardIndex, zoneIndex, 1)
      } catch (e) {
        console.error('Play card failed:', e)
      } finally {
        setSelectedCardIndex(null)
        setSelectedZoneIndex(null)
      }
    },
    [isYourTurn, isFinished, selectedCardIndex, onPlayCard, setSelectedCardIndex, setSelectedZoneIndex]
  )

  const handleZoneCardClick = useCallback(
    async (playerIndex, zoneIndex, card, cardIndex) => {
      if (!isYourTurn || isFinished) return

      if (playerIndex === myIndex) {
        if (hasFlipAbility(card)) {
          const choice = window.confirm('Флюпнуть карту вместо атаки?')
          if (choice) onFlipCard(myIndex, zoneIndex, card.id || cardIndex)
        }
        return
      }

      const toPlayerId = players[playerIndex]?.player_id
      if (!toPlayerId) return
      try {
        await onAttack(zoneIndex, card.id || cardIndex, zoneIndex, toPlayerId)
      } catch (e) {
        console.error('Attack failed:', e)
      }
    },
    [isYourTurn, isFinished, myIndex, onAttack, onFlipCard, players]
  )

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight
        position={[5, 8, 5]}
        intensity={1.4}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <pointLight position={[0, 3, 0]} intensity={0.6} color="#fff4d4" distance={8} decay={2} />

      <TableDecor />

      {opponentSlotPositions.map((opp) => {
        const opponent = safePlayer(players, players[opp.index]?.player_id)
        if (!opponent || opponent.__isFallback) return null

        const opponentZones = normalizePlayerZones(opponent.zones)

        return (
          <React.Fragment key={`player-${opponent.id}`}>
            {opp.positions.map((p, i) => (
              <BuildingSlot key={`p${opponent.id}-b-${i}`} position={p.building} isOpponent />
            ))}
            {opp.positions.map((p, i) => (
              <EnhancedSlot
                key={`p${opponent.id}-land-${i}`}
                position={p.land}
                cards={opponentZones[i] || []}
                ownerAngleRad={ownerRotationY(opp.index, playerCount)}
                isOwnerMe={false}
                isMyTurn={isYourTurn}
                onZoneCardClick={(card, idx) => handleZoneCardClick(opp.index, i, card, idx)}
              />
            ))}
          </React.Fragment>
        )
      })}

      {mySlotPositions.map((p, i) => (
        <BuildingSlot key={`me-b-${i}`} position={p.building} />
      ))}

      {mySlotPositions.map((p, i) => {
        const cards = normalizeZoneCards((me?.zones || [])[i])
        const isSelectedZone = selectedZoneIndex === i
        const isLandPlayable = isYourTurn && selectedCardIndex !== null && cards.length === 0

        return (
          <EnhancedSlot
            key={`me-land-${i}`}
            position={p.land}
            cards={cards}
            ownerAngleRad={ownerRotationY(myIndex, playerCount)}
            isOwnerMe
            isSelected={isSelectedZone}
            isMyTurn={isYourTurn}
            highlighted={isLandPlayable}
            onClick={() => handleLandClick(i)}
            onZoneCardClick={(card, idx) => handleZoneCardClick(myIndex, i, card, idx)}
          />
        )
      })}
    </>
  )
}
