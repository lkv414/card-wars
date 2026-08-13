import { GAME_ACTION_RPC } from './protocol'
import type { Env } from './env'
import { callRpc } from './supabase'

/** Map WS action + payload → Supabase RPC args. Validates actor === clientId. */
export async function runGameAction(
  env: Env,
  gameId: string,
  clientId: string,
  action: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const rpcName = GAME_ACTION_RPC[action]
  if (!rpcName) {
    throw new Error(`Unknown action: ${action}`)
  }

  const args = buildRpcArgs(gameId, clientId, action, payload)
  const data = await callRpc(env, rpcName, args)
  if (data.error) {
    throw new Error(String(data.error))
  }
  return data
}

function buildRpcArgs(
  gameId: string,
  clientId: string,
  action: string,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const playerId = String(payload.playerId ?? payload.p_player_id ?? clientId)
  if (playerId !== clientId) {
    throw new Error('Можно выполнять действия только от своего player_id')
  }

  const base = { p_game_id: gameId, p_player_id: clientId }

  switch (action) {
    case 'play_card':
      return {
        ...base,
        p_card_index: payload.cardIndex ?? payload.p_card_index,
        p_zone_position: payload.zonePosition ?? payload.p_zone_position,
        p_slot_type: payload.slotType ?? payload.p_slot_type,
      }
    case 'draw_free':
    case 'draw_paid':
    case 'shuffle_deck':
    case 'end_turn':
      return base
    case 'forfeit':
      return { p_guest_id: clientId, p_game_id: gameId }
    case 'confirm_land_setup':
    case 'discard_from_hand':
      return { ...base, p_card_index: payload.cardIndex ?? payload.p_card_index }
    case 'discard_from_zone':
      return {
        ...base,
        p_zone_position: payload.zonePosition ?? payload.p_zone_position,
        p_card_id: payload.cardId ?? payload.p_card_id,
      }
    case 'attack':
      return {
        ...base,
        p_from_zone: payload.fromZone ?? payload.p_from_zone,
        p_attacker_card_id: String(payload.attackerCardId ?? payload.p_attacker_card_id ?? ''),
        p_to_player_id: payload.toPlayerId ?? payload.p_to_player_id,
        p_to_zone: payload.toZone ?? payload.p_to_zone,
      }
    case 'flip_card':
      return {
        ...base,
        p_zone_position: payload.zonePosition ?? payload.p_zone_position,
        p_card_id: String(payload.cardId ?? payload.p_card_id ?? ''),
      }
    case 'reorder_lands':
      return {
        ...base,
        p_land_ids: payload.landIds ?? payload.p_land_ids,
      }
    default:
      return { ...base, ...payload }
  }
}
