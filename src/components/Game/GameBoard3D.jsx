/**
 * GameBoard3D — 3D-сцена игрового стола (Three.js + react-three-fiber).
 *
 * Сейчас это **чистая 3D-сцена**: только стол, карты, свет, камера.
 * Весь HUD (кнопки, баннеры, статусы) вынесен в <HUDOverlay> рядом.
 *
 * Композиция (от дальнего к ближнему к камере):
 *   1. Сторона противника: 4 строения (ближе к центру) + 4 земли (ближе к игроку-через-центр)
 *   2. Сторона игрока: 4 строения + 4 земли
 *   3. Летающие карты в воздухе перед игроком (дугой)
 *   4. Камера — подвешена над своей стороной стола, смотрит на центр
 *
 * Карты — 3D-плоскости через <Card3DModel>. Hover/select через raycast.
 */
import { Suspense, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { Card3DModel } from './Card3DModel'
import { HUDOverlay } from './HUDOverlay'

// Размеры стола и слотов
const TABLE_DEPTH = 12
const TABLE_RADIUS = 6  // радиус круглого стола
const SLOT_WIDTH = 1.1  // плитки чуть меньше
const SLOT_DEPTH = 1.4
const SLOT_GAP = 0.4
const NUM_SLOTS = 4

// Высота камеры — высоко над столом, чтобы видеть обе стороны
const CAMERA_HEIGHT = 9
const CAMERA_BACK = 2  // ближе к центру, выше

/**
 * 3D-сцена внутри Canvas. Получает game, playerId, колбэки.
 * HUD НЕ рендерится здесь — он в <HUDOverlay>.
 */
function Scene({ game, playerId, onPlayCard, onAttack, selectedCardIndex, setSelectedCardIndex }) {
  const isPlayer1 = playerId === game.players[0].player_id
  const me = isPlayer1 ? game.players[0] : game.players[1]
  const opp = isPlayer1 ? game.players[1] : game.players[0]

  const isYourTurn = game.current_player_id === playerId
  const isFinished = game.status === 'finished'

  // Позиции слотов на стороне игрока
  const mySlotPositions = useMemo(() => {
    return Array.from({ length: NUM_SLOTS }).map((_, i) => {
      const x = (i - (NUM_SLOTS - 1) / 2) * (SLOT_WIDTH + SLOT_GAP)
      return {
        building: [x, 0.05, 3.0],
        land: [x, 0.05, 1.5],
      }
    })
  }, [])

  // Противник — зеркально по X и по Z
  const oppSlotPositions = useMemo(() => {
    return Array.from({ length: NUM_SLOTS }).map((_, i) => {
      const x = -(i - (NUM_SLOTS - 1) / 2) * (SLOT_WIDTH + SLOT_GAP)
      return {
        building: [x, 0.05, -3.0],
        land: [x, 0.05, -1.5],
      }
    })
  }, [])

  // Позиции карт в воздухе перед игроком (дугой)
  const handCards = me.hand || []

  return (
    <>
      {/* Свет */}
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[5, 8, 5]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <pointLight position={[-3, 4, 3]} intensity={0.4} color="#aab8ff" />

      {/* Круглый стол */}
      <mesh receiveShadow position={[0, 0, 0]}>
        <cylinderGeometry args={[TABLE_RADIUS, TABLE_RADIUS, 0.18, 64]} />
        <meshStandardMaterial color="#2a3a5e" roughness={0.85} />
      </mesh>

      {/* Декор центра стола — большое золотое кольцо */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.09, 0]}>
        <ringGeometry args={[1.6, 2.0, 48]} />
        <meshStandardMaterial color="#ffd700" emissive="#ffd700" emissiveIntensity={0.25} side={THREE.DoubleSide} />
      </mesh>

      {/* ЗЕМЛИ противника (4 слота) */}
      {oppSlotPositions.map((p, i) => {
        const cards = (opp.zones || [])[i] || []
        return (
          <Slot
            key={`opp-land-${i}`}
            position={p.land}
            cards={cards}
            isOpponent
            onClick={null}
            onAttack={(cid) => onAttack(i, cid, i)}
          />
        )
      })}

      {/* СТРОЕНИЯ противника (4 слота) */}
      {oppSlotPositions.map((p, i) => (
        <BuildingSlot key={`opp-b-${i}`} position={p.building} isOpponent />
      ))}

      {/* СТРОЕНИЯ игрока (4 слота) */}
      {mySlotPositions.map((p, i) => (
        <BuildingSlot key={`me-b-${i}`} position={p.building} />
      ))}

      {/* ЗЕМЛИ игрока (4 слота) */}
      {mySlotPositions.map((p, i) => {
        const cards = (me.zones || [])[i] || []
        return (
          <Slot
            key={`me-land-${i}`}
            position={p.land}
            cards={cards}
            isOpponent={false}
            onClick={() => {
              if (!isYourTurn || isFinished) return
              if (selectedCardIndex === null) return
              onPlayCard(selectedCardIndex, i, 1)
              setSelectedCardIndex(null)
            }}
            highlighted={selectedCardIndex !== null && isYourTurn}
          />
        )
      })}

      {/* ЛЕТАЮЩАЯ РУКА перед игроком */}
      <group position={[0, 1.6, TABLE_DEPTH / 2 - 0.3]}>
        {handCards.map((card, idx) => {
          const offset = (idx - (handCards.length - 1) / 2) * 0.85
          const arc = Math.pow(Math.abs(idx - (handCards.length - 1) / 2), 2) * 0.05
          return (
            <Card3DModel
              key={`hand-${idx}`}
              card={card}
              position={[offset, -arc, 0]}
              rotation={[0, -idx * 0.02, 0]}
              onClick={() => {
                if (!isYourTurn || isFinished) return
                setSelectedCardIndex(selectedCardIndex === idx ? null : idx)
              }}
              isSelected={selectedCardIndex === idx}
            />
          )
        })}
      </group>
    </>
  )
}

/**
 * Slot — высокий блок-земля, на который кладутся карты.
 * Карты стоят вертикально сверху (как фишки на поле).
 */
function Slot({ position, cards = [], isOpponent, onClick, onAttack, highlighted = false }) {
  return (
    <group position={position}>
      {/* Высокий блок-земля (как пьедестал для карт) */}
      <mesh
        receiveShadow
        castShadow
        onClick={(e) => {
          e.stopPropagation()
          if (onClick) onClick()
        }}
      >
        <boxGeometry args={[SLOT_WIDTH, 0.5, SLOT_DEPTH]} />
        <meshStandardMaterial
          color={highlighted ? '#5d4e8a' : (isOpponent ? '#1f2a40' : '#2c3e5e')}
          emissive={highlighted ? '#4caf50' : '#000000'}
          emissiveIntensity={highlighted ? 0.4 : 0}
          roughness={0.7}
        />
      </mesh>

      {/* Карты стоят на верхушке блока */}
      {cards.map((card, ci) => (
        <Card3DModel
          key={card.id || ci}
          card={card}
          position={[0, 0.3 + ci * 0.02, -SLOT_DEPTH / 2 + 0.5 + ci * 0.05]}
          rotation={[-Math.PI / 2.4, 0, 0]}
          isFaceUp={!isOpponent}
          onAttack={onAttack ? () => onAttack(card.id) : null}
        />
      ))}
    </group>
  )
}

/**
 * BuildingSlot — плоская плитка (как декор, чуть приподнятая над столом).
 */
function BuildingSlot({ position, isOpponent = false }) {
  return (
    <mesh receiveShadow position={position}>
      <boxGeometry args={[SLOT_WIDTH, 0.1, SLOT_DEPTH]} />
      <meshStandardMaterial
        color={isOpponent ? '#1a2335' : '#243a52'}
        emissive="#3b82f6"
        emissiveIntensity={0.15}
        roughness={0.6}
      />
    </mesh>
  )
}

/**
 * Главный компонент: Canvas + Scene + HUDOverlay.
 */
export function GameBoard3D({
  game,
  playerId,
  onGameEnd,
  onPlayCard,
  onAttack,
  onEndTurn,
  onForfeit,
  realtimeStatus = 'connecting',
}) {
  const [selectedCardIndex, setSelectedCardIndex] = useState(null)

  // Камера — подвешена над своей стороной стола
  const cameraPosition = useMemo(() => [0, CAMERA_HEIGHT, TABLE_DEPTH / 2 - CAMERA_BACK], [])

  // Данные для HUDOverlay
  const isPlayer1 = playerId === game.players[0].player_id
  const me = isPlayer1 ? game.players[0] : game.players[1]
  const opp = isPlayer1 ? game.players[1] : game.players[0]
  const isYourTurn = game.current_player_id === playerId
  const isFinished = game.status === 'finished'
  const winnerId = game.winner_id
  const handCards = me.hand || []

  return (
    <div className="game-board-3d">
      <Canvas
        shadows
        camera={{ position: cameraPosition, fov: 60 }}
        gl={{ antialias: true }}
        style={{ background: 'linear-gradient(180deg, #0a0a1e 0%, #1a1a3e 100%)' }}
      >
        <Suspense fallback={null}>
          <Scene
            game={game}
            playerId={playerId}
            onPlayCard={onPlayCard}
            onAttack={onAttack}
            selectedCardIndex={selectedCardIndex}
            setSelectedCardIndex={setSelectedCardIndex}
          />
        </Suspense>

        {/* OrbitControls: можно крутить камеру мышью (для дебага).
            В проде лучше выключить, чтобы игрок не крутил стол. */}
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
        winnerId={winnerId}
        me={me}
        opp={opp}
        handCards={handCards}
        log={game.game_state?.log || []}
        onEndTurn={onEndTurn}
        onForfeit={onForfeit}
        onGameEnd={onGameEnd}
        realtimeStatus={realtimeStatus}
      />

      <style>{`.game-board-3d { position: relative; width: 100vw; height: 100vh; overflow: hidden; }`}</style>
    </div>
  )
}

export default GameBoard3D
