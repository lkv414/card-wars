/**
 * shared/game-engine/types.ts — реэкспорт типов из серверного движка.
 *
 * ВНИМАНИЕ: файл в workers/game-engine/types.ts — единственный источник правды.
 * Здесь только re-export для клиентского использования.
 */

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

export { isEngineError } from '../../workers/src/game-engine/types.js'
