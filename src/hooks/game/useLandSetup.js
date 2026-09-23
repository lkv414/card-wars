import { useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { getGuestId } from '../../utils/guestId'
import { ensureGuestId } from '../../utils/guestSession'
import { runViaTransport, transportError, transportOk } from './runViaTransport'
import { ALLOW_CLIENT_FALLBACK } from '../../utils/featureFlags'

export function useLandSetup(game, reload, { transport } = {}) {
  const reorderLands = useCallback(
    async (landIds) => {
      if (!game?.id) return
      await ensureGuestId()

      const ws = await runViaTransport(transport, 'reorder_lands', { landIds })
      const wsErr = transportError(ws)
      if (wsErr) throw new Error(wsErr.error)
      if (transportOk(ws)) return
      if (!ALLOW_CLIENT_FALLBACK) throw new Error('Перестановка земель недоступна (обновите сервер)')

      const { error } = await supabase.rpc('reorder_player_lands', {
        p_game_id: game.id,
        p_player_id: getGuestId(),
        p_land_ids: landIds,
      })
      if (error) throw new Error(error.message)
    },
    [game?.id, transport],
  )

  const confirmLandSetup = useCallback(
    async ({ landIds = [], bypass = false } = {}) => {
      if (!game?.id) return
      await ensureGuestId()

      const ws = await runViaTransport(transport, 'confirm_land_setup', { landIds, bypass })
      const wsErr = transportError(ws)
      if (wsErr) throw new Error(wsErr.error)
      if (transportOk(ws)) return
      if (!ALLOW_CLIENT_FALLBACK) throw new Error('Подтверждение земель недоступно (обновите сервер)')

      const { error } = await supabase.rpc('confirm_land_setup', {
        p_game_id: game.id,
        p_player_id: getGuestId(),
        p_bypass: bypass,
      })
      if (error) throw new Error(error.message)
      await reload?.()
    },
    [game?.id, reload, transport],
  )

  return { reorderLands, confirmLandSetup }
}