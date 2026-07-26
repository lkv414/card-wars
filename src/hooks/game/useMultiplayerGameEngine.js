/**
 * useMultiplayerGameEngine — Игровой движок для 2-4 игроков
 * 
 * Реализует правила Card Wars для multiplayer:
 * - Адаптивные зоны боя
 * - Бой между соответствующими землями
 * - Флюп механика
 * - Пассивные способности
 * - Урон по юнитам и HP
 */

import { useState, useCallback } from 'react'
import {
  MAX_PLAYERS,
  ZONES_PER_PLAYER,
  ZONE_OPPOSITION,
  ACTIONS_PER_TURN,
  INITIAL_HEALTH,
  TURN_PHASES,
  TURN_ORDER,
  FLIP_RULES,
  CARD_STATUSES
} from '../../constants/gameMultiplayer'

/**
 * Получение противников для данного игрока
 * @param {number} playerIndex - Индекс текущего игрока
 * @param {number} playerCount - Общее количество игроков
 * @returns {Array} Массив индексов противников
 */
function getOpponents(playerIndex, playerCount) {
  const opponents = []
  for (let i = 0; i < playerCount; i++) {
    if (i !== playerIndex) {
      opponents.push(i)
    }
  }
  return opponents
}

/**
 * Получение зон противника для атаки
 * @param {number} playerIndex - Индекс текущего игрока
 * @param {number} zoneIndex - Индекс зоны текущего игрока
 * @param {number} playerCount - Общее количество игроков
 * @returns {Array} Массив {opponentIndex, opponentZone}
 */
function getOpponentZonesForAttack(playerIndex, zoneIndex, playerCount) {
  const opposition = ZONE_OPPOSITION[playerCount]
  if (!opposition) return []
  
  const playerOpposition = opposition[playerIndex]
  if (!playerOpposition) return []
  
  // Для 2 игроков: все зоны против всех зон
  if (playerCount === 2) {
    return playerOpposition.opponentZones.map(opponentZone => ({
      opponentIndex: playerOpposition.opponentIndex,
      opponentZone
    }))
  }
  
  // Для 3-4 игроков: левые зоны (0,1) против правых зон (2,3) соседа
  // Правые зоны (2,3) против левых зон (0,1) соседа
  if (zoneIndex < 2) {
    // Левые зоны
    return playerOpposition.opponentZones.map(opponentZone => ({
      opponentIndex: playerOpposition.opponentIndex,
      opponentZone: opponentZone
    }))
  } else {
    // Правые зоны - нужно найти другого противника
    // Для этого ищем соседа слева
    const leftNeighborIndex = (playerIndex - 1 + playerCount) % playerCount
    const leftNeighborOpposition = opposition[leftNeighborIndex]
    if (leftNeighborOpposition) {
      return leftNeighborOpposition.opponentZones.map(opponentZone => ({
        opponentIndex: leftNeighborOpposition.opponentIndex,
        opponentZone: opponentZone
      }))
    }
  }
  
  return []
}

/**
 * Основной хук игрового движка для multiplayer
 */
export function useMultiplayerGameEngine(initialGameState = null) {
  const [gameState, setGameState] = useState({
    players: [],
    currentPlayerIndex: 0,
    turnPhase: TURN_PHASES.draw,
    turnNumber: 0,
    actionsRemaining: ACTIONS_PER_TURN,
    maxPlayers: MAX_PLAYERS,
    ...initialGameState
  })

  /**
   * Инициализация игры с указанным количеством игроков
   */
  const initializeGame = useCallback((playerCount = 2, playerData = []) => {
    const players = Array.from({ length: playerCount }, (_, index) => ({
      id: `player_${index}`,
      index,
      health: INITIAL_HEALTH,
      hand: [],
      deck: [],
      deckRemaining: 0,
      zones: Array.from({ length: ZONES_PER_PLAYER }, () => ({
        cards: [],
        land: null
      })),
      actionsUsed: 0,
      isActive: true,
      ...(playerData[index] || {})
    }))

    setGameState({
      players,
      currentPlayerIndex: 0,
      turnPhase: TURN_PHASES.draw,
      turnNumber: 0,
      actionsRemaining: ACTIONS_PER_TURN,
      maxPlayers: playerCount,
      playerCount
    })
  }, [])

  /**
   * Получение текущего игрока
   */
  const getCurrentPlayer = useCallback(() => {
    return gameState.players[gameState.currentPlayerIndex]
  }, [gameState])

  /**
   * Получение противников текущего игрока
   */
  const getCurrentOpponents = useCallback(() => {
    const currentIndex = gameState.currentPlayerIndex
    return getOpponents(currentIndex, gameState.playerCount)
  }, [gameState])

  /**
   * Переход к следующему ходу
   */
  const nextTurn = useCallback(() => {
    setGameState(prev => {
      // Следующий игрок
      const nextPlayerIndex = (prev.currentPlayerIndex + 1) % prev.playerCount
      
      // Проверяем, что игрок активен
      const nextPlayer = prev.players[nextPlayerIndex]
      if (!nextPlayer.isActive) {
        // Пропускаем неактивных игроков
        return {
          ...prev,
          currentPlayerIndex: nextPlayerIndex
        }
      }

      return {
        ...prev,
        currentPlayerIndex: nextPlayerIndex,
        turnPhase: TURN_PHASES.draw,
        turnNumber: nextPlayerIndex === 0 ? prev.turnNumber + 1 : prev.turnNumber,
        actionsRemaining: ACTIONS_PER_TURN
      }
    })
  }, [])

  /**
   * Подготовка всех карт в начале хода (по правилам)
   */
  const prepareCards = useCallback(() => {
    setGameState(prev => {
      const updatedPlayers = prev.players.map((player, index) => {
        if (index !== prev.currentPlayerIndex) return player
        
        // Готовим все карты игрока
        const updatedZones = player.zones.map(zone => ({
          ...zone,
          cards: zone.cards.map(card => ({
            ...card,
            status: CARD_STATUSES.ready
          }))
        }))
        
        return {
          ...player,
          zones: updatedZones,
          actionsUsed: 0
        }
      })
      
      return {
        ...prev,
        players: updatedPlayers,
        actionsRemaining: ACTIONS_PER_TURN
      }
    })
  }, [])

  /**
   * Сыграть карту из руки в указанную зону
   */
  const playCard = useCallback((cardIndex, zoneIndex, playerIndex = null) => {
    const currentIndex = playerIndex || gameState.currentPlayerIndex
    const currentPlayer = gameState.players[currentIndex]
    
    if (!currentPlayer || currentPlayer.hand[cardIndex] == null) {
      return { success: false, error: 'Невалидная карта или игрок' }
    }
    
    if (gameState.actionsRemaining <= 0) {
      return { success: false, error: 'Нет доступных действий' }
    }

    const card = currentPlayer.hand[cardIndex]
    
    // Проверяем, что карта может быть сыграна на эту землю
    if (card.land_type && card.land_type !== 'any') {
      const land = currentPlayer.zones[zoneIndex]?.land
      if (land?.type !== card.land_type) {
        return { success: false, error: `Нужна земля типа: ${card.land_type}` }
      }
    }

    setGameState(prev => {
      const updatedPlayers = [...prev.players]
      const player = updatedPlayers[currentIndex]
      
      // Удаляем карту из руки
      const newHand = [...player.hand]
      newHand.splice(cardIndex, 1)
      
      // Добавляем карту в зону
      const newZones = [...player.zones]
      newZones[zoneIndex] = {
        ...newZones[zoneIndex],
        cards: [...newZones[zoneIndex].cards, {
          ...card,
          status: CARD_STATUSES.ready,
          zoneIndex,
          playerIndex: currentIndex,
          instanceId: `card_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        }]
      }
      
      updatedPlayers[currentIndex] = {
        ...player,
        hand: newHand,
        zones: newZones,
        actionsUsed: player.actionsUsed + 1
      }
      
      return {
        ...prev,
        players: updatedPlayers,
        actionsRemaining: prev.actionsRemaining - 1
      }
    })
    
    return { success: true }
  }, [gameState])

  /**
   * Флюпнуть карту в зоне
   */
  const flipCard = useCallback((playerIndex, zoneIndex, cardInstanceId) => {
    const currentIndex = playerIndex || gameState.currentPlayerIndex
    
    if (!FLIP_RULES.canFlipInOpponentTurn && currentIndex !== gameState.currentPlayerIndex) {
      return { success: false, error: 'Можно флюпать только в свой ход' }
    }

    setGameState(prev => {
      const updatedPlayers = [...prev.players]
      const player = updatedPlayers[currentIndex]
      const zone = player.zones[zoneIndex]
      
      if (!zone) {
        return prev
      }
      
      const updatedCards = zone.cards.map(card => {
        if (card.instanceId === cardInstanceId) {
          return {
            ...card,
            status: CARD_STATUSES.flipped
          }
        }
        return card
      })
      
      updatedPlayers[currentIndex] = {
        ...player,
        zones: player.zones.map((z, i) => 
          i === zoneIndex ? { ...z, cards: updatedCards } : z
        )
      }
      
      return {
        ...prev,
        players: updatedPlayers
      }
    })
    
    return { success: true }
  }, [gameState])

  /**
   * Атаковать картой из зоны
   */
  const attack = useCallback((playerIndex, zoneIndex, cardInstanceId, targetPlayerIndex, targetZoneIndex) => {
    const currentIndex = playerIndex || gameState.currentPlayerIndex
    const currentPlayer = gameState.players[currentIndex]
    
    if (!currentPlayer) {
      return { success: false, error: 'Невалидный игрок' }
    }
    
    // Проверяем, что карта может атаковать
    const zone = currentPlayer.zones[zoneIndex]
    const card = zone?.cards?.find(c => c.instanceId === cardInstanceId)
    
    if (!card) {
      return { success: false, error: 'Карта не найдена' }
    }
    
    // Флюпнутые карты не могут атаковать
    if (card.status === CARD_STATUSES.flipped && !FLIP_RULES.flippedCanAttack) {
      return { success: false, error: 'Флюпнутая карта не может атаковать' }
    }
    
    // Карта должна быть ready или tapped (активирована для атаки)
    if (card.status !== CARD_STATUSES.ready && card.status !== CARD_STATUSES.tapped) {
      return { success: false, error: 'Карта не готова к атаке' }
    }

    // Получаем цель
    const targetPlayer = gameState.players[targetPlayerIndex]
    const targetZone = targetPlayer?.zones[targetZoneIndex]
    const targetCard = targetZone?.cards?.[0] // Атакуем первую карту в зоне
    
    setGameState(prev => {
      const updatedPlayers = [...prev.players]
      const player = updatedPlayers[currentIndex]
      const target = updatedPlayers[targetPlayerIndex]
      
      // Если есть карта цели - наносим урон по картам
      if (targetCard && card.type === 'creature' && targetCard.type === 'creature') {
        const cardDamage = card.attack || 0
        const targetDamage = targetCard.attack || 0
        
        // Наносим урон атакующей карте
        const updatedAttacker = {
          ...card,
          damageTaken: (card.damageTaken || 0) + targetDamage,
          status: CARD_STATUSES.tapped
        }
        
        // Наносим урон карте цели
        const updatedTarget = {
          ...targetCard,
          damageTaken: (targetCard.damageTaken || 0) + cardDamage,
          status: CARD_STATUSES.tapped
        }
        
        // Обновляем зоны
        const playerZones = player.zones.map((z, i) => {
          if (i === zoneIndex) {
            const updatedCards = z.cards.map(c => 
              c.instanceId === cardInstanceId ? updatedAttacker : c
            )
            // Удаляем погибшие карты
            const survivingCards = updatedCards.filter(c => 
              (c.defense || 0) > (c.damageTaken || 0)
            )
            return { ...z, cards: survivingCards }
          }
          return z
        })
        
        const targetZones = target.zones.map((z, i) => {
          if (i === targetZoneIndex) {
            const updatedCards = z.cards.map(c => 
              c.instanceId === targetCard.instanceId ? updatedTarget : c
            )
            const survivingCards = updatedCards.filter(c => 
              (c.defense || 0) > (c.damageTaken || 0)
            )
            return { ...z, cards: survivingCards }
          }
          return z
        })
        
        updatedPlayers[currentIndex] = { ...player, zones: playerZones }
        updatedPlayers[targetPlayerIndex] = { ...target, zones: targetZones }
      } else {
        // Атакуем игрока напрямую
        if (card.type === 'creature') {
          const damage = card.attack || 0
          updatedPlayers[targetPlayerIndex] = {
            ...target,
            health: Math.max(0, (target.health || INITIAL_HEALTH) - damage)
          }
          
          // Карта атакующего поворачивается (tapped)
          const playerZones = player.zones.map((z, i) => {
            if (i === zoneIndex) {
              return {
                ...z,
                cards: z.cards.map(c => 
                  c.instanceId === cardInstanceId ? { ...c, status: CARD_STATUSES.tapped } : c
                )
              }
            }
            return z
          })
          
          updatedPlayers[currentIndex] = { ...player, zones: playerZones }
        }
      }
      
      // Проверяем, погиб ли игрок
      if (updatedPlayers[targetPlayerIndex].health <= 0) {
        updatedPlayers[targetPlayerIndex] = {
          ...updatedPlayers[targetPlayerIndex],
          isActive: false
        }
      }
      
      return {
        ...prev,
        players: updatedPlayers
      }
    })
    
    return { success: true }
  }, [gameState])

  /**
   * Завершить фазу хода
   */
  const endPhase = useCallback(() => {
    setGameState(prev => {
      const currentPhaseIndex = TURN_ORDER.indexOf(prev.turnPhase)
      const nextPhaseIndex = (currentPhaseIndex + 1) % TURN_ORDER.length
      const nextPhase = TURN_ORDER[nextPhaseIndex]
      
      // Если переход к фазе атаки - подготовить карты
      if (nextPhase === TURN_PHASES.attack) {
        return {
          ...prev,
          turnPhase: nextPhase
        }
      }
      
      // Если переход к фазе draw - следующий ход
      if (nextPhase === TURN_PHASES.draw) {
        return {
          ...prev,
          turnPhase: nextPhase,
          currentPlayerIndex: (prev.currentPlayerIndex + 1) % prev.playerCount,
          turnNumber: prev.currentPlayerIndex === prev.playerCount - 1 
            ? prev.turnNumber + 1 
            : prev.turnNumber,
          actionsRemaining: ACTIONS_PER_TURN
        }
      }
      
      return {
        ...prev,
        turnPhase: nextPhase
      }
    })
  }, [])

  /**
   * Получение доступных зон для атаки из указанной зоны
   */
  const getAvailableAttackZones = useCallback((playerIndex, zoneIndex) => {
    const player = gameState.players[playerIndex]
    if (!player) return []
    
    const playerCount = gameState.playerCount
    return getOpponentZonesForAttack(playerIndex, zoneIndex, playerCount)
  }, [gameState])

  /**
   * Проверка, может ли игрок урон по карте
   */
  const canDealDamageToCard = useCallback((attackerPlayerIndex, attackerZoneIndex, attackerCardId, targetPlayerIndex, targetZoneIndex) => {
    const attacker = gameState.players[attackerPlayerIndex]
    const target = gameState.players[targetPlayerIndex]
    
    if (!attacker || !target) return false
    
    const attackerCard = attacker.zones[attackerZoneIndex]?.cards?.find(c => c.instanceId === attackerCardId)
    if (!attackerCard || attackerCard.type !== 'creature') return false
    
    // Проверяем, что zoneIndex есть в доступных для атаки
    const availableZones = getAvailableAttackZones(attackerPlayerIndex, attackerZoneIndex)
    const canAttackZone = availableZones.some(z => 
      z.opponentIndex === targetPlayerIndex && z.opponentZone === targetZoneIndex
    )
    
    return canAttackZone
  }, [gameState, getAvailableAttackZones])

  /**
   * Получение информации о текущем состоянии игры
   */
  const getGameInfo = useCallback(() => ({
    currentPlayer: getCurrentPlayer(),
    currentPlayerIndex: gameState.currentPlayerIndex,
    turnPhase: gameState.turnPhase,
    turnNumber: gameState.turnNumber,
    actionsRemaining: gameState.actionsRemaining,
    opponents: getCurrentOpponents(),
    activePlayers: gameState.players.filter(p => p.isActive),
    playerCount: gameState.playerCount
  }), [gameState, getCurrentPlayer, getCurrentOpponents])

  return {
    // Состояние
    gameState,
    
    // Гетеры
    getCurrentPlayer,
    getCurrentOpponents,
    getGameInfo,
    getAvailableAttackZones,
    canDealDamageToCard,
    
    // Экшены
    initializeGame,
    nextTurn,
    prepareCards,
    playCard,
    flipCard,
    attack,
    endPhase,
    
    // Константы
    MAX_PLAYERS,
    ZONES_PER_PLAYER,
    ACTIONS_PER_TURN,
    INITIAL_HEALTH,
    TURN_PHASES,
    CARD_STATUSES
  }
}

export default useMultiplayerGameEngine
