import { useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { getGuestId } from '../../utils/guestId'
import { ensureGuestId } from '../../utils/guestSession'
import { publishGameSync } from '../../utils/gameSync'

export function useLandSetup(game, reload) {
  const reorderLands = useCallback(
    async (landIds) => {
      if (!game?.id) return
      await ensureGuestId()
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
    [game?.id, game?.version]
  )

  const confirmLandSetup = useCallback(async () => {
    if (!game?.id) return
    await ensureGuestId()
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
  }, [game?.id, game?.version, reload])

  return { reorderLands, confirmLandSetup }
}
