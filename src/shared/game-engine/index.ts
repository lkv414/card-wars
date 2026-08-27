/**
 * Client-side game engine mirror — re-exports the same `validateAction`
 * and `applyAction` the Worker uses, so the UI can pre-validate and
 * run optimistic updates with identical logic.
 *
 * The source of truth is `workers/src/game-engine/`. When you change
 * a file there, mirror the change here. (We accept the duplication
 * rather than introducing a cross-package build step — the engine is
 * pure TS and ~30 KB.)
 */
export {
  validateAction,
  type ValidationResult,
} from './validation.js'
export type { Action, GameState, PlayerState, Card, Zone } from './types.js'
export { applyAction, isError as isEngineError } from './engine.js'
export type { ApplyResult, EngineError, BattleEvent } from './types.js'