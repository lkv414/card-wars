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
import { safePlayers, safePlayer } from '../../utils/safePlayer'

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
  const players = useMemo(() => safePlayers(game.players), [game.players])
  const playerCount = players.length
  let myIndex = players.findIndex(p => p.player_id === playerId)

  if (myIndex === -1 && players.length > 0) {
    // Fallback для старых данных — берём первого, не падаем на players[1] если их <2
    myIndex = 0
  }

  // safePlayer гарантирует все поля; myIndex === -1 → safePlayer вернёт фоллбек
  const me = myIndex >= 0 ? safePlayer(players, players[myIndex]?.player_id) : safePlayer([], null)
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

  // Обработка клика по земле для размещения карты
  const handleLandClick = useCallback(async (zoneIndex) => {
    if (!isYourTurn || isFinished || selectedCardIndex === null) return
    try {
      await onPlayCard(selectedCardIndex, zoneIndex, myIndex)
    } catch (e) {
      console.error('Play card failed:', e)
    } finally {
      // Сбрасываем выделение в ЛЮБОМ случае — иначе карта «зависнет» выбранной.
      setSelectedCardIndex(null)
      setSelectedZoneIndex(null)
    }
  }, [isYourTurn, isFinished, selectedCardIndex, myIndex, onPlayCard, setSelectedCardIndex, setSelectedZoneIndex])

  // Обработка клика по карте в зоне (атака или флюп)
  const handleZoneCardClick = useCallback(async (playerIndex, zoneIndex, card, cardIndex) => {
    if (!isYourTurn || isFinished) return

    // Атаковать можно ТОЛЬКО по чужим картам (не по своим).
    // Клик по своей карте в 3D-сцене — это flip-ability, а не атака.
    if (playerIndex === myIndex) {
      if (card?.abilities?.includes('Флюп')) {
        const choice = window.confirm('Флюпнуть карту вместо атаки?')
        if (choice) onFlipCard(myIndex, zoneIndex, card.id || cardIndex)
      }
      return
    }

    // Атака чужой карты: toPlayerId обязателен для 3-4 игроков.
    const toPlayerId = players[playerIndex]?.player_id
    if (!toPlayerId) return
    try {
      await onAttack(zoneIndex, card.id || cardIndex, zoneIndex, toPlayerId)
    } catch (e) {
      console.error('Attack failed:', e)
    }
  }, [isYourTurn, isFinished, myIndex, onAttack, onFlipCard, players])

  return (
    <>
      {/* Свет — максимум 3 источника (perf).
          - ambient: базовое освещение всего
          - directional: основной + тени
          - point (тёплый): подсвечивает центр стола снизу */}
      <ambientLight intensity={0.7} />
      <directionalLight
        position={[5, 8, 5]}
        intensity={1.4}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <pointLight position={[0, 3, 0]} intensity={0.6} color="#fff4d4" distance={8} decay={2} />
      {/* Per-player подсветки убраны для производительности.
          Различаем противников через emissive-цвета слотов (см. ниже). */}

      {/* === Декор стола === */}
      {/* Основной каменный диск (тёмный, чуть шершавый) */}
      <mesh receiveShadow position={[0, 0, 0]}>
        <cylinderGeometry args={[TABLE_RADIUS, TABLE_RADIUS, 0.18, 64]} />
        <meshStandardMaterial color="#1f2940" roughness={0.95} metalness={0.05} />
      </mesh>

      {/* Внутренний круг — каменная плита с лёгким золотым тиснением */}
      <mesh receiveShadow position={[0, 0.092, 0]}>
        <cylinderGeometry args={[TABLE_RADIUS - 0.5, TABLE_RADIUS - 0.5, 0.02, 64]} />
        <meshStandardMaterial color="#2a3554" roughness={0.7} metalness={0.15} />
      </mesh>

      {/* Золотое кольцо-обод по краю стола (большое) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.094, 0]}>
        <ringGeometry args={[TABLE_RADIUS - 0.55, TABLE_RADIUS - 0.4, 64]} />
        <meshStandardMaterial color="#ffd700" emissive="#ffd700" emissiveIntensity={0.35} side={THREE.DoubleSide} />
      </mesh>

      {/* Центральный золотой круг (зона действия/мана) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.095, 0]}>
        <ringGeometry args={[1.6, 2.0, 48]} />
        <meshStandardMaterial color="#ffd700" emissive="#ffd700" emissiveIntensity={0.3} side={THREE.DoubleSide} />
      </mesh>

      {/* 8 декоративных рун вокруг центрального круга */}
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i / 8) * Math.PI * 2
        const r = 1.8
        const x = Math.cos(a) * r
        const z = Math.sin(a) * r
        return (
          <mesh key={`rune-${i}`} rotation={[-Math.PI / 2, 0, a]} position={[x, 0.097, z]}>
            <ringGeometry args={[0.12, 0.18, 6]} />
            <meshStandardMaterial color="#7fb3ff" emissive="#7fb3ff" emissiveIntensity={0.6} side={THREE.DoubleSide} />
          </mesh>
        )
      })}

      {/* Внутренний заливочный круг (полупрозрачный, как мана-поле) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.093, 0]}>
        <circleGeometry args={[1.55, 48]} />
        <meshStandardMaterial color="#3d5a8a" transparent opacity={0.18} side={THREE.DoubleSide} />
      </mesh>

      {/* Рендерим всех противников */}
      {opponentSlotPositions.map((opp) => {
        // safePlayer защищает от players[opp.index] === undefined / sparse arrays
        const opponent = safePlayer(players, players[opp.index]?.player_id)
        if (!opponent || opponent.__isFallback) return null

        // safePlayer гарантирует zones = { 0: [], 1: [], 2: [], 3: [] }
        const opponentZones = opponent.zones || { 0: [], 1: [], 2: [], 3: [] }

        return (
          <React.Fragment key={`player-${opponent.id}`}>
            {/* СТРОЕНИЯ противника */}
            {opp.positions.map((p, i) => (
              <BuildingSlot
                key={`p${opponent.id}-b-${i}`}
                position={p.building}
                isOpponent
              />
            ))}

            {/* ЗЕМЛИ и карты противников */}
            {opp.positions.map((p, i) => {
              const zone = opponentZones[i] || { cards: [] }
              const cards = zone.cards || []

              return (
                <EnhancedSlot
                  key={`p${opponent.id}-land-${i}`}
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

      {/* Рука вынесена в HUDOverlay (DOM-слой) — летающее 3D-меню убрано */}
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
            isOpponent={isOpponent}
            showStats={canShowStats}
            showFlipOption={isMyTurn && !isOpponent}
            // Кликабельность: передаём onClick, чтобы EnhancedCard3DModel
            // прокинул событие через raycast → родительский onZoneCardClick.
            // Без этого карты оппонента НЕ реагировали на клики.
            onClick={() => {
              if (onZoneCardClick) onZoneCardClick(card, ci)
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
  
  const players = useMemo(() => safePlayers(game.players), [game.players])
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
  // safePlayer гарантирует что me никогда не null со всеми нужными полями
  const isPlayer1 = playerId === players[0]?.player_id
  const fallbackPlayer = isPlayer1 ? players[0] : players[1]
  const me = safePlayer(players, players[myIndex]?.player_id || fallbackPlayer?.player_id)
  const opp = safePlayer(players, players.find((p) => p.player_id !== (players[myIndex]?.player_id || playerId))?.player_id)
  const isYourTurn = game.current_player_id === playerId
  const isFinished = game.status === 'finished'
  const winnerId = game.winner_id
  const handCards = me?.hand || []  // safePlayer даёт hand: []

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
        opp={opp}
        handCards={handCards}
        log={game.game_state?.log || []}
        onEndTurn={onEndTurn}
        onForfeit={onForfeit}
        onGameEnd={onGameEnd}
        realtimeStatus={realtimeStatus}
        // для рендера руки в HUD + клика по картам руки
        selectedCardIndex={selectedCardIndex}
        setSelectedCardIndex={setSelectedCardIndex}
      />

      <style>{`.game-board-3d { position: relative; width: 100vw; height: 100vh; overflow: hidden; }`}</style>
    </div>
  )
}

export default GameBoard3D
