/**
 * Public API для game-хуков.
 */

export { useGameAction } from './useGameAction'
export { usePlayCard } from './usePlayCard'
export { useAttack } from './useAttack'
export { useTurnControl } from './useTurnControl'
export { useFlipCard, hasFlipAbility } from './useFlipCard'
export { clampZones } from './format'
export { getAttackTargets, canAttack, getNeighbor, getNextAliveNeighbor, ZONE_OPPOSITION } from './zoneOpposition'