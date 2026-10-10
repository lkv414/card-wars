/**
 * shared/game-engine/validation.ts — реэкспорт валидации из серверного движка.
 *
 * ВНИМАНИЕ: файл в workers/game-engine/validation.ts — единственный источник правды.
 */

export {
  validateAction,
} from '../../workers/src/game-engine/validation.js'

export type { ValidationResult } from '../../workers/src/game-engine/validation.js'
