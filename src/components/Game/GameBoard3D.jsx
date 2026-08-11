/**
 * GameBoard3D — 3D-сцена игрового стола (Three.js + react-three-fiber).
 */
import { Suspense, useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { HUDOverlay } from './HUDOverlay'
import { GameScene } from './gameBoard3D/GameScene'
import { calculateCameraPosition, TABLE_DEPTH, CAMERA_HEIGHT, CAMERA_BACK } from './gameBoard3D/layout'
import { safePlayers, safePlayer } from '../../utils/safePlayer'

export function GameBoard3D({
  game,
  playerId,
  onGameEnd,
  onPlayCard,
  onAttack,
  onEndTurn,
  onForfeit,
  onFlipCard,
  realtimeStatus = 'connecting',
  isApplying = false,
  actionError = null,
}) {
  const [selectedCardIndex, setSelectedCardIndex] = useState(null)
  const [selectedZoneIndex, setSelectedZoneIndex] = useState(null)

  const players = useMemo(() => safePlayers(game.players), [game.players])
  const playerCount = players.length
  const myIndex = players.findIndex((p) => p.player_id === playerId)

  const cameraPosition = useMemo(() => {
    if (myIndex === -1) {
      return [0, CAMERA_HEIGHT, TABLE_DEPTH / 2 - CAMERA_BACK]
    }
    return calculateCameraPosition(myIndex, playerCount)
  }, [myIndex, playerCount])

  const isPlayer1 = playerId === players[0]?.player_id
  const fallbackPlayer = isPlayer1 ? players[0] : players[1]
  const me = safePlayer(players, players[myIndex]?.player_id || fallbackPlayer?.player_id)
  const opp = safePlayer(
    players,
    players.find((p) => p.player_id !== (players[myIndex]?.player_id || playerId))?.player_id
  )
  const isYourTurn = game.current_player_id === playerId
  const isFinished = game.status === 'finished'
  const handCards = me?.hand || []

  const handleFlipCard = useCallback(
    (playerIndex, zoneIndex, cardId) => {
      onFlipCard?.(playerIndex, zoneIndex, cardId)
    },
    [onFlipCard]
  )

  const onPlayCardRef = useRef(onPlayCard)
  useEffect(() => {
    onPlayCardRef.current = onPlayCard
  }, [onPlayCard])

  const handleCanvasDrop = useCallback(
    (e) => {
      e.preventDefault()
      const cardIdxStr = e.dataTransfer.getData('text/card-index')
      if (!cardIdxStr) return
      const cardIdx = parseInt(cardIdxStr, 10)
      if (Number.isNaN(cardIdx)) return
      if (e.target?.closest?.('.hud-hand')) return

      const myZones = me?.zones || []
      const firstEmpty = myZones.findIndex((z) =>
        Array.isArray(z) ? z.length === 0 : (z?.cards?.length || 0) === 0
      )
      if (firstEmpty === -1) return
      if (typeof onPlayCardRef.current === 'function') {
        Promise.resolve(onPlayCardRef.current(cardIdx, firstEmpty, 1)).catch((err) => {
          console.error('[Drop] play failed:', err)
        })
      }
    },
    [me]
  )

  const handleCanvasDragOver = useCallback((e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('text/card-index')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    }
  }, [])

  return (
    <div className="game-board-3d">
      <Canvas
        shadows
        camera={{ position: cameraPosition, fov: 60 }}
        gl={{ antialias: true }}
        style={{ background: 'linear-gradient(180deg, #0a0a1e 0%, #1a1a3e 100%)' }}
        onDragOver={handleCanvasDragOver}
        onDrop={handleCanvasDrop}
      >
        <Suspense fallback={null}>
          <GameScene
            game={game}
            playerId={playerId}
            onPlayCard={onPlayCard}
            onAttack={onAttack}
            onFlipCard={handleFlipCard}
            selectedCardIndex={selectedCardIndex}
            setSelectedCardIndex={setSelectedCardIndex}
            selectedZoneIndex={selectedZoneIndex}
            setSelectedZoneIndex={setSelectedZoneIndex}
          />
        </Suspense>
        <OrbitControls
          enablePan={false}
          minPolarAngle={Math.PI / 6}
          maxPolarAngle={Math.PI / 2.2}
          minDistance={4}
          maxDistance={12}
        />
      </Canvas>

      <HUDOverlay
        playerId={playerId}
        isYourTurn={isYourTurn}
        isFinished={isFinished}
        winnerId={game.winner_id}
        me={me}
        opp={opp}
        handCards={handCards}
        log={game.game_state?.log || []}
        onEndTurn={onEndTurn}
        onForfeit={onForfeit}
        onGameEnd={onGameEnd}
        realtimeStatus={realtimeStatus}
        selectedCardIndex={selectedCardIndex}
        setSelectedCardIndex={setSelectedCardIndex}
        isApplying={isApplying}
        actionError={actionError}
        onPlayCard={onPlayCard}
      />
    </div>
  )
}

export default GameBoard3D
