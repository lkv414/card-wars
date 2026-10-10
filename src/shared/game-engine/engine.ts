/**
 * shared/game-engine/engine.ts — реэкспорт диспетчера из серверного движка.
 *
 * ВНИМАНИЕ: файл в workers/game-engine/engine.ts — единственный источник правды.
 */

export {
  applyAction,
  validateAction,
  isError,
  isEngineError,
} from '../../workers/src/game-engine/engine.js'
