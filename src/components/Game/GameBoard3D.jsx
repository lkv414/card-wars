/**
 * GameBoard3D — 3D-сцена игрового стола (Three.js + react-three-fiber).
 *
 * Композиция (от дальнего к ближнему к камере):
 *   1. Сторона противника: 4 строения (ближе к центру) + 4 земли (ближе к игроку-через-центр)
 *   2. Центральная панель с HUD: статус хода, лог, кнопка "Закончить ход"
 *   3. Сторона игрока: 4 строения + 4 земли
 *   4. Летающие карты в воздухе перед игроком (дугой)
 *   5. Камера — подвешена над своей стороной стола, смотрит на центр
 *
 * Карты — 3D-плоскости через <Card3DModel>. Hover/select через raycast.
 *
 * Сцена НЕ переключает DOM-разметку — это единый <Canvas>, поверх через HTML overlay
 * выводится HUD (используем <Html> из drei).
 */
import { Suspense, useState, useEffect, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Html, Text } from '@react-three/drei'
import * as THREE from 'three'
import { Card3DModel } from './Card3DModel'

// Размеры стола и слотов
const TABLE_WIDTH = 10
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
 */
function Scene({ game, playerId, onPlayCard, onAttack, onEndTurn, selectedCardIndex, setSelectedCardIndex }) {
  const isPlayer1 = playerId === game.players[0].player_id
  const me = isPlayer1 ? game.players[0] : game.players[1]
  const opp = isPlayer1 ? game.players[1] : game.players[0]

  const isYourTurn = game.current_player_id === playerId
  const isFinished = game.status === 'finished'
  const winnerId = game.winner_id

  // Позиции слотов на стороне игрока (front = ближе к камере/игроку)
  // Симметрично от центра стола (z=0):
  //   Земли:  z = +1.5  (ближе к центру)
  //   Строения: z = +3.0  (ближе к игроку, на дальнем от центра конце стола)
  // Моя сторона:
  //   Строения: z = +3.0  (ближе к игроку/камере)
  //   Земли:    z = +1.5  (ближе к центру стола)
  const mySlotPositions = useMemo(() => {
    return Array.from({ length: NUM_SLOTS }).map((_, i) => {
      const x = (i - (NUM_SLOTS - 1) / 2) * (SLOT_WIDTH + SLOT_GAP)
      return {
        building: [x, 0.05, 3.0],
        land: [x, 0.05, 1.5],
      }
    })
  }, [])

  // Противник — зеркально по X и по Z.
  //   Строения: z = -3.0  (ближе к противнику)
  //   Земли:    z = -1.5  (ближе к центру стола)
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
  const HAND_START_Z = TABLE_DEPTH / 2 - 0.5
  const HAND_CARD_SPACING = 0.85

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
          const offset = (idx - (handCards.length - 1) / 2) * HAND_CARD_SPACING
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

      {/* HUD в центре стола */}
      <Html
        position={[0, 2.5, 0]}
        center
        distanceFactor={6}
        style={{ pointerEvents: 'auto', userSelect: 'none' }}
      >
        <div className="scene-hud">
          {isFinished ? (
            <div className="hud-finished">
              🎉 {winnerId === playerId ? 'Вы выиграли!' : 'Вы проиграли!'}
            </div>
          ) : (
            <div className={`hud-turn ${isYourTurn ? 'your' : 'opponent'}`}>
              {isYourTurn ? '👉 Ваш ход' : '⏳ Ход противника'}
              <div className="hud-stats">
                ❤️ Вы {me.health}/25 · 🤚 Рука {handCards.length} · 📚 Колода {me.deck_remaining}
              </div>
              {isYourTurn && (
                <button className="hud-end-btn" onClick={onEndTurn}>Закончить ход</button>
              )}
            </div>
          )}
        </div>
      </Html>

      {/* HUD противника (сверху-далеко) */}
      <Html
        position={[0, 3, -TABLE_DEPTH / 2 - 0.3]}
        center
        distanceFactor={6}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        <div className="scene-hud-opponent">
          Противник · ❤️ {opp.health}/25 · 🂠 × {opp.hand?.length || 0}
        </div>
      </Html>
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
 * Главный компонент: Canvas + Scene.
 */
export function GameBoard3D({
  game,
  playerId,
  onGameEnd,
  onPlayCard,
  onAttack,
  onEndTurn,
}) {
  const [selectedCardIndex, setSelectedCardIndex] = useState(null)

  // Камера — подвешена над своей стороной стола
  const cameraPosition = useMemo(() => [0, CAMERA_HEIGHT, TABLE_DEPTH / 2 - CAMERA_BACK], [])

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
            onEndTurn={onEndTurn}
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

      {/* Кнопка выхода в лобби — поверх Canvas (вне Three.js) */}
      <button className="exit-3d-btn" onClick={onGameEnd}>
        ← Выйти из игры
      </button>

      {/* Минимальные CSS-стили для HUD-оверх Three.js */}
      <style>{`
        .game-board-3d {
          position: relative;
          width: 100vw;
          height: 100vh;
          overflow: hidden;
        }
        .scene-hud {
          background: rgba(20, 20, 50, 0.85);
          padding: 12px 18px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          backdrop-filter: blur(8px);
          color: white;
          text-align: center;
          min-width: 240px;
          font-family: 'Segoe UI', system-ui, sans-serif;
          box-shadow: 0 4px 24px rgba(0,0,0,0.4);
        }
        .scene-hud .hud-turn.your { color: #4caf50; }
        .scene-hud .hud-turn.opponent { color: #ff9800; }
        .scene-hud .hud-stats { margin-top: 6px; font-size: 13px; opacity: 0.85; }
        .scene-hud .hud-finished { font-size: 18px; font-weight: 700; }
        .hud-end-btn {
          margin-top: 8px;
          padding: 6px 14px;
          background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%);
          border: none;
          border-radius: 6px;
          color: white;
          font-weight: 700;
          cursor: pointer;
        }
        .scene-hud-opponent {
          background: rgba(20, 20, 50, 0.7);
          padding: 6px 14px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.15);
          color: rgba(255, 255, 255, 0.85);
          font-size: 13px;
          font-family: 'Segoe UI', system-ui, sans-serif;
        }
        .exit-3d-btn {
          position: absolute;
          top: 12px;
          left: 12px;
          padding: 6px 14px;
          background: rgba(0,0,0,0.5);
          color: white;
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 6px;
          cursor: pointer;
          z-index: 100;
          font-family: 'Segoe UI', system-ui, sans-serif;
        }
        .exit-3d-btn:hover { background: rgba(0,0,0,0.8); }
      `}</style>
    </div>
  )
}

export default GameBoard3D