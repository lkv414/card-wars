/**
 * Public API для game-хуков.
 *
 * Импортируйте отсюда:
 *   import { useGameAction, gameToEngineFormat } from '../hooks/game'
 *
 * Или напрямую:
 *   import { usePlayCard } from '../hooks/game/usePlayCard'
 */

export { useGameAction, gameToEngineFormat } from './useGameAction'
export { useGameState } from './useGameState'
export { usePlayCard } from './usePlayCard'
export { useAttack } from './useAttack'
export { useTurnControl } from './useTurnControl'
export { clampZones } from './format'