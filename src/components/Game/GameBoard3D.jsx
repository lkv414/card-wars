/**
 * GameBoard3D — 3D-сцена игрового стола (Three.js + react-three-fiber).
 */
import { Suspense, useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { HUDOverlay } from './HUDOverlay'
import { GameScene } from './gameBoard3D/GameScene'
import { AdaptiveBoardCamera, CAMERA_FOV, PLAY_FIELD_Y } from './gameBoard3D/AdaptiveBoardCamera'
import { getBoardLookAtTarget } from './gameBoard3D/layout'
import { safePlayers, safePlayer } from '../../utils/safePlayer'

import { DamageFlashOverlay } from './DamageFlashOverlay'
import { LandSetupOverlay } from './LandSetupOverlay'
import { canPlayerDealDamage } from '../../hooks/game/combat'
import { battleEventsToVisuals } from '../../hooks/game/battlePhase'
import { useGraphicsSettings } from '../../hooks/useGraphicsSettings'

export function GameBoard3D({
  game,
  playerId,
  landCatalog = {},
  onGameEnd,
  onPlayCard,
  onAttack,
  onDrawFreeCard,
  onDrawPaidCard,
  onShuffleDeck,
  onDiscardFromHand,
  onEndTurn,
  onSuppressRealtimeReload,
  onForfeit,
  onFlipCard,
  onDiscardFromZone,
  onReorderLands,
  onConfirmLandSetup,
  realtimeStatus = 'connecting',
  isApplying = false,
  actionError = null,
  toast = () => {},
}) {
  const { shadowsEnabled } = useGraphicsSettings()
  const [selectedCardIndex, setSelectedCardIndex] = useState(null)
  const [selectedZoneIndex, setSelectedZoneIndex] = useState(null)
  const [draggingCardIndex, setDraggingCardIndex] = useState(null)
  const [damageFlash, setDamageFlash] = useState(false)
  const [damageMarkers, setDamageMarkers] = useState([])
  const [battleEvents, setBattleEvents] = useState([])
  const [cardActionMenu, setCardActionMenu] = useState(null)
  const [zoneCardActionMenu, setZoneCardActionMenu] = useState(null)

  const boardRef = useRef(null)
  const pointerRef = useRef({ x: 0, y: 0 })
  const rayTargetRef = useRef(null)
  const placingLockRef = useRef(false)
  const cardIndexRef = useRef(null)

  useEffect(() => {
    cardIndexRef.current = draggingCardIndex ?? selectedCardIndex
  }, [draggingCardIndex, selectedCardIndex])

  const players = useMemo(() => safePlayers(game.players), [game.players])
  const playerCount = players.length
  const myIndex = players.findIndex((p) => p.player_id === playerId)
  const controlsRef = useRef(null)
  const boardTarget = useMemo(() => getBoardLookAtTarget(), [])

  const isPlayer1 = playerId === players[0]?.player_id
  const fallbackPlayer = isPlayer1 ? players[0] : players[1]
  const me = safePlayer(players, players[myIndex]?.player_id || fallbackPlayer?.player_id)
  const opp = safePlayer(
    players,
    players.find((p) => p.player_id !== (players[myIndex]?.player_id || playerId))?.player_id
  )
  const isYourTurn = game.current_player_id === playerId
  const isFinished = game.status === 'finished'
  const inSetup = game.status === 'setup'
  const handCards = me?.hand || []
  const actionsRemaining = isYourTurn
    ? (me?.actions_remaining ?? game.actions_remaining ?? 2)
    : 0
  const aliveCount = players.filter((p) => (p.health ?? 0) > 0).length
  const canDealDamage = canPlayerDealDamage(
    me?.player_order,
    aliveCount,
    game.current_turn ?? 0
  )

  const isPlacementActive =
    isYourTurn && !isFinished && !inSetup && (selectedCardIndex !== null || draggingCardIndex !== null)

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

  const onPlayCardRef = useRef(onPlayCard)
  useEffect(() => {
    onPlayCardRef.current = onPlayCard
  }, [onPlayCard])

  const handleRayRelease = useCallback(
    async (cardIdx, target) => {
      if (placingLockRef.current) return
      const card = handCards[cardIdx]
      if (!card || !target) return

      placingLockRef.current = true
      setDraggingCardIndex(null)
      try {
        const result = await onPlayCardRef.current?.(cardIdx, target.zoneIndex, 1, target.slotType)
        if (result?.error) {
          toast('error', result.error)
          return
        }
        setSelectedCardIndex(null)
        rayTargetRef.current = null
      } catch (err) {
        toast('error', err?.message || 'Не удалось сыграть карту')
      } finally {
        placingLockRef.current = false
      }
    },
    [handCards, toast, setDraggingCardIndex]
  )

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
      if (markers.length > 0) {
        setDamageMarkers((prev) => [...prev, ...markers])
        for (const m of markers) {
          setTimeout(() => {
            setDamageMarkers((prev) => prev.filter((x) => x.key !== m.key))
          }, 1400)
        }
      }
      if (flashMe) {
        setDamageFlash(true)
        setTimeout(() => setDamageFlash(false), 550)
      }
      await new Promise((r) => setTimeout(r, 900))
    }

    return result
  }, [onEndTurn, onSuppressRealtimeReload, playerId, toast])

  const handleFlipCard = useCallback(
    async (playerIndex, zoneIndex, cardId) => {
      const result = await onFlipCard?.(playerIndex, zoneIndex, cardId)
      if (result?.error) toast('error', result.error)
    },
    [onFlipCard, toast]
  )

  const handleRequestZoneAction = useCallback(
    ({ zoneIndex, card, canFlip }) => {
      const cardId = card.id || card.instanceId
      setZoneCardActionMenu({
        card,
        onFlip: canFlip
          ? () => handleFlipCard(myIndex, zoneIndex, cardId)
          : undefined,
        onDiscard: () => onDiscardFromZone?.(zoneIndex, cardId).then((r) => {
          if (r?.error) toast('error', r.error)
        }),
      })
    },
    [handleFlipCard, myIndex, onDiscardFromZone, toast]
  )

  const handleBoardPointerDown = useCallback(
    (e) => {
      updatePointer(e.clientX, e.clientY)
    },
    [updatePointer]
  )

  return (
    <div
      ref={boardRef}
      className={`game-board-3d${isPlacementActive ? ' game-board-3d--placing' : ''}`}
      onPointerDown={handleBoardPointerDown}
    >
      <Canvas
        shadows={shadowsEnabled}
        camera={{
          fov: CAMERA_FOV,
          near: 0.1,
          far: 100,
          position: [0, PLAY_FIELD_Y + 12, 12],
        }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        style={{ background: 'linear-gradient(180deg, #5a6a75 0%, #3d4a52 100%)' }}
        onCreated={({ gl }) => {
          gl.domElement.style.touchAction = 'none'
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.08
          if (shadowsEnabled) gl.shadowMap.type = THREE.PCFSoftShadowMap
          const canvas = gl.domElement
          canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault()
            toast('error', 'WebGL контекст потерян — перезагрузите страницу')
          })
        }}
      >
        <AdaptiveBoardCamera
          playerIndex={myIndex}
          playerCount={playerCount}
          controlsRef={controlsRef}
        />
        <Suspense fallback={null}>
          <GameScene
            game={game}
            playerId={playerId}
            landCatalog={landCatalog}
            onPlayCard={onPlayCard}
            onFlipCard={handleFlipCard}
            onDiscardFromZone={onDiscardFromZone}
            onRequestZoneAction={handleRequestZoneAction}
            damageMarkers={damageMarkers}
            selectedCardIndex={selectedCardIndex}
            setSelectedCardIndex={setSelectedCardIndex}
            selectedZoneIndex={selectedZoneIndex}
            setSelectedZoneIndex={setSelectedZoneIndex}
            draggingCardIndex={draggingCardIndex}
            setDraggingCardIndex={setDraggingCardIndex}
            handCards={handCards}
            pointerRef={pointerRef}
            rayTargetRef={rayTargetRef}
            placingLockRef={placingLockRef}
            isPlacementActive={isPlacementActive}
            boardRectRef={boardRef}
            cardIndexRef={cardIndexRef}
            onRayRelease={handleRayRelease}
          />
        </Suspense>
        <OrbitControls
          ref={controlsRef}
          target={boardTarget}
          enablePan={false}
          minPolarAngle={Math.PI / 4}
          maxPolarAngle={Math.PI / 2.05}
          enabled={!draggingCardIndex}
        />
      </Canvas>

      {game.status === 'setup' && (
        <LandSetupOverlay
          game={game}
          playerId={playerId}
          landCatalog={landCatalog}
          onReorder={async (...args) => {
            try {
              await onReorderLands?.(...args)
            } catch (e) {
              toast('error', e?.message || 'Не удалось переставить земли')
            }
          }}
          onConfirm={async () => {
            try {
              await onConfirmLandSetup?.()
            } catch (e) {
              toast('error', e?.message || 'Не удалось подтвердить расстановку')
            }
          }}
          isApplying={isApplying}
        />
      )}

      <DamageFlashOverlay active={damageFlash} />

      <HUDOverlay
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
        cardActionMenu={cardActionMenu}
        zoneCardActionMenu={zoneCardActionMenu}
        onCloseCardActionMenu={() => setCardActionMenu(null)}
        onCloseZoneCardActionMenu={() => setZoneCardActionMenu(null)}
      />
    </div>
  )
}

export default GameBoard3D
