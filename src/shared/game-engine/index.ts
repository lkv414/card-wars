/**
 * shared/game-engine/index.ts — реэкспорт из серверного движка.
 *
 * Внимание: это зеркало движка для клиентской pre-validation.
 * Основной движок находится в workers/game-engine.
 *
 * Для избежания циклических зависимостей импортируем напрямую,
 * а не через этот файл в серверном коде.
 */

// Типы
export type {
  Card,
  Zone,
  PlayerState,
  CardCatalogEntry,
  GameState,
  ApplyResult,
  BattleEvent,
  EngineError,
  Action,
  ActionName,
} from '../../workers/src/game-engine/types.js'

// Утилиты
export {
  bumpVersion,
  getActivePlayer,
  getPlayer,
  getAlivePlayers,
  getZone,
  reshuffleIfNeeded,
  drawTopCard,
  shuffleDeck,
  pushDiscard,
  seededRng,
} from '../../workers/src/game-engine/utils.js'

// Движок
export {
  applyAction,
  validateAction,
  isError,
} from '../../workers/src/game-engine/engine.js'

// Механики
export {
  hydrateMechanics,
  hydrateAction,
  mechanicSummary,
} from '../../workers/src/game-engine/mechanics.js'
