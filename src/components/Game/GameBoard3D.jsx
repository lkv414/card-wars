/**
 * GameBoard3D — 3D-сцена игрового стола (Three.js + react-three-fiber).
 *
 * Адаптивная сцена для 2-4 игроков с улучшенными картами.
 * Весь HUD (кнопки, баннеры, статусы) вынесен в <HUDOverlay> рядом.
 *
 * Композиция (от дальнего к ближнему к камере):
 *   - Для 2 игроков: противник напротив, игрок внизу
 *   - Для 3-4 игроков: игроки расположены по кругу
 *   
 * Карты — 3D-плоскости через <EnhancedCard3DModel> с отображением характеристик.
 * Hover/select через raycast.
 */
import React, { Suspense, useMemo, useState, useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { EnhancedCard3DModel } from './EnhancedCard3DModel'
import { HUDOverlay } from './HUDOverlay'
import { ZONES_PER_PLAYER } from '../../constants/gameMultiplayer'

// Размеры стола и слотов
const TABLE_DEPTH = 12
const TABLE_RADIUS = 6  // радиус круглого стола
const SLOT_WIDTH = 1.1  // плитки чуть меньше
const SLOT_DEPTH = 1.4
const SLOT_GAP = 0.4
const NUM_SLOTS = ZONES_PER_PLAYER

// Высота камеры — высоко над столом, чтобы видеть все стороны
const CAMERA_HEIGHT = 9
const CAMERA_BACK = 2  // ближе к центру, выше

// Углы для расположения игроков по кругу (для 3-4 игроков)
const PLAYER_ANGLES = {
  2: [180, 0],        // 2 игрока: напротив друг друга
  3: [180, 60, 300], // 3 игрока: равномерно по кругу
  4: [180, 90, 0, 270] // 4 игрока: по квадрантам
}

// Расстояние от центра до стороны игрока
const PLAYER_DISTANCE = 4

/**
 * Хелпер для расчета позиций слотов игрока
 * @param {number} playerIndex - Индекс игрока
 * @param {number} playerCount - Общее количество игроков
 * @returns {Array} Массив позиций {building, land} для каждого слота
 */
function calculatePlayerSlotPositions(playerIndex, playerCount) {
  const angle = PLAYER_ANGLES[playerCount]?.[playerIndex] || 0
  const rad = (angle * Math.PI) / 180
  
  // Для 2 игроков: специфические позиции
  if (playerCount === 2) {
    if (playerIndex === 0) {
      // Игрок 0 (нижний)
      return Array.from({ length: NUM_SLOTS }).map((_, i) => {
        const x = (i - (NUM_SLOTS - 1) / 2) * (SLOT_WIDTH + SLOT_GAP)
        return {
          building: [x, 0.05, 3.0],
          land: [x, 0.05, 1.5],
        }
      })
    } else {
      // Игрок 1 (верхний)
      return Array.from({ length: NUM_SLOTS }).map((_, i) => {
        const x = -(i - (NUM_SLOTS - 1) / 2) * (SLOT_WIDTH + SLOT_GAP)
        return {
          building: [x, 0.05, -3.0],
          land: [x, 0.05, -1.5],
        }
      })
    }
  }
  
  // Для 3-4 игроков: расположение по кругу
  const baseX = Math.cos(rad) * PLAYER_DISTANCE
  const baseZ = Math.sin(rad) * PLAYER_DISTANCE
  
  return Array.from({ length: NUM_SLOTS }).map((_, i) => {
    // Слоты расположены дугой относительно игрока
    const slotOffset = (i - (NUM_SLOTS - 1) / 2) * (SLOT_WIDTH + SLOT_GAP)
    // Поворот слотов вдоль окружности
    const slotX = baseX + slotOffset * Math.cos(rad + Math.PI / 2)
    const slotZ = baseZ + slotOffset * Math.sin(rad + Math.PI / 2)
    
    return {
      building: [slotX, 0.05, slotZ],
      land: [slotX, 0.05, slotZ + 1.5],
    }
  })
}

/**
 * Хелпер для расчета позиции руки игрока
 * @param {number} playerIndex - Индекс игрока
 * @param {number} playerCount - Общее количество игроков
 * @returns {Array} [x, y, z] позиция для группы карт руки
 */
function calculateHandPosition(playerIndex, playerCount) {
  const angle = PLAYER_ANGLES[playerCount]?.[playerIndex] || 0
  const rad = (angle * Math.PI) / 180
  
  if (playerCount === 2) {
    if (playerIndex === 0) {
      return [0, 1.6, TABLE_DEPTH / 2 - 0.3]
    } else {
      return [0, 1.6, -TABLE_DEPTH / 2 + 0.3]
    }
  }
  
  // Для 3-4 игроков
  const baseX = Math.cos(rad) * (PLAYER_DISTANCE - 1)
  const baseZ = Math.sin(rad) * (PLAYER_DISTANCE - 1)
  return [baseX, 1.6, baseZ]
}

/**
 * Хелпер для расчета позиции камеры для игрока
 * @param {number} playerIndex - Индекс текущего игрока
 * @param {number} playerCount - Общее количество игроков
 * @returns {Array} [x, y, z] позиция камеры
 */
function calculateCameraPosition(playerIndex, playerCount) {
  const angle = PLAYER_ANGLES[playerCount]?.[playerIndex] || 0
  const rad = (angle * Math.PI) / 180
  
  if (playerCount === 2) {
    if (playerIndex === 0) {
      return [0, CAMERA_HEIGHT, TABLE_DEPTH / 2 - CAMERA_BACK]
    } else {
      return [0, CAMERA_HEIGHT, -TABLE_DEPTH / 2 + CAMERA_BACK]
    }
  }
  
  // Для 3-4 игроков
  const camDistance = PLAYER_DISTANCE + 3
  const camX = Math.cos(rad) * camDistance
  const camZ = Math.sin(rad) * camDistance
  return [camX, CAMERA_HEIGHT, camZ]
}

/**
 * 3D-сцена внутри Canvas. Получает game, playerId, колбэки.
 * HUD НЕ рендерится здесь — он в <HUDOverlay>.
 */
function Scene({ 
  game, 
  playerId, 
  onPlayCard, 
  onAttack, 
  onFlipCard,
  selectedCardIndex, 
  setSelectedCardIndex,
  selectedZoneIndex,
  setSelectedZoneIndex
}) {
  const players = game.players || []
  const playerCount = players.length
  let myIndex = players.findIndex(p => p.player_id === playerId)
  
  if (myIndex === -1) {
    // Fallback для старых данных
    const isPlayer1 = playerId === game.players?.[0]?.player_id
    myIndex = isPlayer1 ? 0 : 1
  }

  const me = players[myIndex]
  const isYourTurn = game.current_player_id === playerId
  const isFinished = game.status === 'finished'

  // Позиции слотов для всех игроков
  const playerSlotPositions = useMemo(() => {
    return Array.from({ length: playerCount }).map((_, index) => 
      calculatePlayerSlotPositions(index, playerCount)
    )
  }, [playerCount])

  // Позиции слотов текущего игрока
  const mySlotPositions = playerSlotPositions[myIndex] || calculatePlayerSlotPositions(myIndex, playerCount)
  
  // Позиции слотов противников
  const opponentSlotPositions = useMemo(() => {
    const opponents = []
    for (let i = 0; i < playerCount; i++) {
      if (i !== myIndex) {
        opponents.push({
          index: i,
          positions: calculatePlayerSlotPositions(i, playerCount)
        })
      }
    }
    return opponents
  }, [playerCount, myIndex])

  // Позиции карт в воздухе перед игроком
  const handPosition = calculateHandPosition(myIndex, playerCount)
  const handCards = me?.hand || []
  
  // Обработка клика по земле для размещения карты
  const handleLandClick = useCallback((zoneIndex) => {
    if (!isYourTurn || isFinished || selectedCardIndex === null) return
    onPlayCard(selectedCardIndex, zoneIndex, myIndex)
    setSelectedCardIndex(null)
    setSelectedZoneIndex(null)
  }, [isYourTurn, isFinished, selectedCardIndex, myIndex, onPlayCard, setSelectedCardIndex, setSelectedZoneIndex])

  // Обработка клика по карте в зоне (атака или флюп)
  const handleZoneCardClick = useCallback((playerIndex, zoneIndex, card, cardIndex) => {
    if (!isYourTurn || isFinished) return
    
    // Если это карта текущего игрока и она может флюпаться
    if (playerIndex === myIndex && card?.abilities?.includes('Флюп')) {
      const choice = window.confirm('Флюпнуть карту вместо атаки?')
      if (choice) {
        onFlipCard(myIndex, zoneIndex, card.id || cardIndex)
      } else {
        // Атака - нужно определить цель
        // Для простоты пока просто вызываем onAttack
        onAttack(zoneIndex, card.id || cardIndex)
      }
    } else if (playerIndex === myIndex) {
      // Обычная атака
      onAttack(zoneIndex, card.id || cardIndex)
    }
  }, [isYourTurn, isFinished, myIndex, onAttack, onFlipCard])

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
      {playerCount === 4 && (
        <>
          <pointLight position={[3, 4, -3]} intensity={0.4} color="#ffaab8" />
          <pointLight position={[3, 4, 3]} intensity={0.4} color="#aaffb8" />
          <pointLight position={[-3, 4, -3]} intensity={0.4} color="#b8aaff" />
        </>
      )}

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

      {/* Рендерим всех противников */}
      {opponentSlotPositions.map((opp) => {
        const opponent = players[opp.index]
        if (!opponent) return null
        
        return (
          <React.Fragment key={`player-${opp.index}`}>
            {/* СТРОЕНИЯ противника */}
            {opp.positions.map((p, i) => (
              <BuildingSlot 
                key={`p${opp.index}-b-${i}`} 
                position={p.building} 
                isOpponent 
              />
            ))}
            
            {/* ЗЕМЛИ и карты противников */}
            {opp.positions.map((p, i) => {
              const zone = (opponent.zones || [])[i] || {}
              const cards = zone.cards || []
              
              return (
                <EnhancedSlot
                  key={`p${opp.index}-land-${i}`}
                  position={p.land}
                  cards={cards}
                  isOpponent
                  isMyTurn={isYourTurn}
                  onZoneCardClick={(card, idx) => handleZoneCardClick(opp.index, i, card, idx)}
                />
              )
            })}
          </React.Fragment>
        )
      })}

      {/* СТРОЕНИЯ текущего игрока */}
      {mySlotPositions.map((p, i) => (
        <BuildingSlot key={`me-b-${i}`} position={p.building} />
      ))}

      {/* ЗЕМЛИ и карты текущего игрока */}
      {mySlotPositions.map((p, i) => {
        const zone = (me?.zones || [])[i] || {}
        const cards = zone.cards || []
        const isSelectedZone = selectedZoneIndex === i
        
        return (
          <EnhancedSlot
            key={`me-land-${i}`}
            position={p.land}
            cards={cards}
            isOpponent={false}
            isSelected={isSelectedZone}
            isMyTurn={isYourTurn}
            onClick={() => handleLandClick(i)}
            onZoneCardClick={(card, idx) => handleZoneCardClick(myIndex, i, card, idx)}
          />
        )
      })}

      {/* ЛЕТАЮЩАЯ РУКА перед игроком */}
      <group position={handPosition}>
        {handCards.map((card, idx) => {
          const offset = (idx - (handCards.length - 1) / 2) * 0.85
          const arc = Math.pow(Math.abs(idx - (handCards.length - 1) / 2), 2) * 0.05
          const isFlipped = card?.status === 'flipped'
          
          return (
            <EnhancedCard3DModel
              key={`hand-${idx}`}
              card={card}
              position={[offset, -arc, 0]}
              rotation={[0, -idx * 0.02, isFlipped ? Math.PI / 2 : 0]}
              onClick={() => {
                if (!isYourTurn || isFinished) return
                setSelectedCardIndex(selectedCardIndex === idx ? null : idx)
              }}
              isSelected={selectedCardIndex === idx}
              isFlipped={isFlipped}
              showStats={true}
              showFlipOption={false}
            />
          )
        })}
      </group>
    </>
  )
}

/**
 * EnhancedSlot — улучшенный слот с EnhancedCard3DModel
 * Отображает карты с характеристиками и поддерживает флюп
 */
function EnhancedSlot({ 
  position, 
  cards = [], 
  isOpponent = false, 
  isSelected = false,
  isMyTurn = false,
  onClick,
  onZoneCardClick,
  highlighted = false
}) {
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
      {cards.map((card, ci) => {
        const isFlipped = card?.status === 'flipped' || card?.isFlipped
        const canShowStats = !isOpponent || card?.isFaceUp
        
        return (
          <EnhancedCard3DModel
            key={card.id || card.instanceId || ci}
            card={card}
            position={[0, 0.3 + ci * 0.02, -SLOT_DEPTH / 2 + 0.5 + ci * 0.05]}
            rotation={[-Math.PI / 2.4, 0, isFlipped ? Math.PI / 2 : 0]}
            isFaceUp={!isOpponent}
            isSelected={isSelected}
            isFlipped={isFlipped}
            showStats={canShowStats}
            showFlipOption={isMyTurn && !isOpponent}
            onClick={() => {
              if (onZoneCardClick) {
                onZoneCardClick(card, ci)
              }
            }}
            onFlip={() => {
              // Флюп обрабатывается через onZoneCardClick с выбором
            }}
          />
        )
      })}
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
  onFlipCard,
  realtimeStatus = 'connecting',
}) {
  const [selectedCardIndex, setSelectedCardIndex] = useState(null)
  const [selectedZoneIndex, setSelectedZoneIndex] = useState(null)
  
  const players = game.players || []
  const playerCount = players.length
  const myIndex = players.findIndex(p => p.player_id === playerId)
  
  // Камера — подвешена над стороной стола текущего игрока
  const cameraPosition = useMemo(() => {
    if (myIndex === -1) {
      return [0, CAMERA_HEIGHT, TABLE_DEPTH / 2 - CAMERA_BACK]
    }
    return calculateCameraPosition(myIndex, playerCount)
  }, [myIndex, playerCount])

  // Данные для HUDOverlay
  const isPlayer1 = playerId === game.players?.[0]?.player_id
  const me = players[myIndex] || (isPlayer1 ? game.players[0] : game.players[1])
  const isYourTurn = game.current_player_id === playerId
  const isFinished = game.status === 'finished'
  const winnerId = game.winner_id
  const handCards = me?.hand || []

  // Обработчик флипа карты
  const handleFlipCard = useCallback((playerIndex, zoneIndex, cardId) => {
    if (onFlipCard) {
      onFlipCard(playerIndex, zoneIndex, cardId)
    }
  }, [onFlipCard])

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
            onFlipCard={handleFlipCard}
            selectedCardIndex={selectedCardIndex}
            setSelectedCardIndex={setSelectedCardIndex}
            selectedZoneIndex={selectedZoneIndex}
            setSelectedZoneIndex={setSelectedZoneIndex}
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
