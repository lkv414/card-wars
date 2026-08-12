import { useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { getGuestId } from '../../utils/guestId'
import { ensureGuestId } from '../../utils/guestSession'

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
      // Realtime обновит состояние; лишний reload здесь забивал пул соединений.
    },
    [game?.id]
  )

  const confirmLandSetup = useCallback(async () => {
    if (!game?.id) return
    await ensureGuestId()
    const { error } = await supabase.rpc('confirm_land_setup', {
      p_game_id: game.id,
      p_player_id: getGuestId(),
    })
    if (error) throw new Error(error.message)
    await reload?.()
  }, [game?.id, reload])

  return { reorderLands, confirmLandSetup }
}
