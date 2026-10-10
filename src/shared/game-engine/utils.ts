/**
 * shared/game-engine/utils.ts — реэкспорт утилит из серверного движка.
 *
 * ВНИМАНИЕ: файл в workers/game-engine/utils.ts — единственный источник правды.
 */

export {
  bumpVersion,
  getActivePlayer,
  getPlayer,
  getAlivePlayers,
  getZone,
  reshuffleIfNeeded,
  drawTopCard,
  refillHand,
  shuffleDeck,
  pushDiscard,
  removeFromDiscard,
  seededRng,
} from '../../workers/src/game-engine/utils.js'
