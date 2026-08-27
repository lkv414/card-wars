/**
 * Client-side pre-flight helper — wraps the engine `validateAction` so
 * the UI can show the same error message that the Worker would return,
 * without the round-trip.
 *
 * Use this in your hooks before `transport.sendAction()`:
 *
 *   const v = validateBeforeSend(game, 'play_card', payload, clientId)
 *   if (!v.ok) { toast(v.error); return }
 *   await transport.sendAction(...)
 */
import { validateAction, type ValidationResult } from '../shared/game-engine/validation.js'

/** Re-export for callers that don't want to dig into shared/. */
export type { ValidationResult }

/**
 * Light wrapper. Pass the broadcast `game` from `useGameStore` and the
 * payload your hook already built; get back the same `{ ok, error }`
 * envelope the server would have returned.
 */
export function validateBeforeSend(
  game: any,
  action: string,
  payload: Record<string, unknown>,
  clientId: string,
): ValidationResult {
  return validateAction(game, action, payload as never, clientId)
}