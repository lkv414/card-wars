import { useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { getGuestId } from '../../utils/guestId'
import { ensureGuestId } from '../../utils/guestSession'
import { publishGameSync } from '../../utils/gameSync'
import { runViaTransport, transportError, transportOk } from './runViaTransport'

export function useLandSetup(game, reload, { transport } = {}) {
  const reorderLands = useCallback(
    async (landIds) => {
      if (!game?.id) return
      await ensureGuestId()

      const ws = await runViaTransport(transport, 'reorder_lands', { landIds })
      const wsErr = transportError(ws)
      if (wsErr) throw new Error(wsErr.error)
      if (transportOk(ws)) return

      const { error } = await supabase.rpc('reorder_player_lands', {
        p_game_id: game.id,
        p_player_id: getGuestId(),
        p_land_ids: landIds,
      })
      if (error) throw new Error(error.message)
      await publishGameSync(game.id, {
        type: 'reload',
        version: (game.version ?? 0) + 1,
        actorId: getGuestId(),
      })
    },
    [game?.id, game?.version, transport]
  )

  const confirmLandSetup = useCallback(async () => {
    if (!game?.id) return
    await ensureGuestId()

    const ws = await runViaTransport(transport, 'confirm_land_setup', {})
    const wsErr = transportError(ws)
    if (wsErr) throw new Error(wsErr.error)
    if (transportOk(ws)) return

    const { error } = await supabase.rpc('confirm_land_setup', {
      p_game_id: game.id,
      p_player_id: getGuestId(),
    })
    if (error) throw new Error(error.message)
    await publishGameSync(game.id, {
      type: 'reload',
      version: (game.version ?? 0) + 1,
      actorId: getGuestId(),
    })
    await reload?.()
  }, [game?.id, game?.version, reload, transport])

  return { reorderLands, confirmLandSetup }
}
