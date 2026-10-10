/**
 * shared/game-engine/turn.ts — реэкспорт ходовых функций из серверного движка.
 *
 * ВНИМАНИЕ: файл в workers/game-engine/turn.ts — единственный источник правды.
 */

export {
  endTurn,
  forfeitGame,
} from '../../workers/src/game-engine/turn.js'
