import { useCallback } from 'react'
import { ensureGuestId } from '@/utils/guestSession'
import { runViaTransport, transportError, transportOk } from './runViaTransport'

/**
 * Activate a server-side manual mechanic. The Worker is authoritative; the
 * client only supplies the card instance, mechanic index, and selected targets.
 */
export function useAbility(_game, { transport, suppressRealtimeReload } = {}) {
  return useCallback(async ({ playerId, zonePosition, cardId, mechanicIndex, targetCardIds = [] }) => {
    await ensureGuestId()
    const result = await runViaTransport(transport, 'use_ability', {
      playerId,
      zonePosition,
      cardId: String(cardId),
      mechanicIndex: Number(mechanicIndex),
      targetCardIds,
    })
    const error = transportError(result)
    if (error) return error
    const ok = transportOk(result)
    if (ok && typeof suppressRealtimeReload === 'function') suppressRealtimeReload(500)
    return ok || { success: true }
  }, [transport, suppressRealtimeReload])
}
