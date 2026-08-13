/**
 * useFlipCard — хук для флюпа карт на поле (RPC flip_card + outbox sync).
 */
import { useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { ensureGuestId } from '../../utils/guestSession'
import { hasFlipAbility } from './cardAbilities.js'
import { applyFlipCardPatch } from '../../utils/gameStatePatch'
import { publishGameSync } from '../../utils/gameSync'

export { hasFlipAbility } from './cardAbilities.js'

import { runViaTransport, transportError, transportOk } from './runViaTransport'

export function useFlipCard(game, { patchGame, transport, suppressRealtimeReload } = {}) {
  const flipCard = useCallback(
    async (playerIndex, zoneIndex, cardId) => {
      if (!game?.players) return { error: 'Игра не загружена' }

      await ensureGuestId()

      const player = game.players?.[playerIndex]
      if (!player) {
        return { error: 'Игрок не найден' }
      }

      const zone = player.zones?.[zoneIndex]
      if (!zone) {
        return { error: 'Зона не найдена' }
      }

      const card = (zone.cards || []).find(
        (c) => c.id === cardId || c.instanceId === cardId
      )
      if (!card) {
        return { error: 'Карта не найдена' }
      }

      if (!hasFlipAbility(card)) {
        return { error: 'У карты нет способности Флюп' }
      }

      const ws = await runViaTransport(transport, 'flip_card', {
        zonePosition: zoneIndex + 1,
        cardId: String(cardId),
      })
      const wsErr = transportError(ws)
      if (wsErr) return wsErr
      const wsOk = transportOk(ws)
      if (wsOk) return wsOk

      const { data, error: rpcErr } = await supabase.rpc('flip_card', {
        p_game_id: game.id,
        p_player_id: player.player_id,
        p_zone_position: zoneIndex + 1,
        p_card_id: String(cardId),
      })

      if (rpcErr) {
        return { error: rpcErr.message }
      }
      if (data?.error) {
        return { error: data.error }
      }

      if (typeof patchGame === 'function') {
        patchGame((state) =>
          applyFlipCardPatch(state, player.player_id, zoneIndex, cardId, data.version)
        )
      }

      // Suppress realtime reload for 3s to avoid interrupting flip animation (~300ms)
      if (typeof suppressRealtimeReload === 'function') {
        suppressRealtimeReload(3000)
      }

      await publishGameSync(game.id, {
        type: 'flip_card',
        version: data.version,
        actorId: player.player_id,
        playerId: player.player_id,
        zoneIndex,
        cardId,
      })

      return { success: true }
    },
    [game, patchGame, transport, suppressRealtimeReload]
  )

  return flipCard
}
