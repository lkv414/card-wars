/** Shared WebSocket protocol — client ↔ Cloudflare Durable Object rooms. */

export type ClientMessage =
  | { type: 'join'; clientId: string; requestId?: string }
  | { type: 'ping'; requestId?: string }
  | { type: 'action'; action: string; payload?: Record<string, unknown>; requestId?: string }

export type ServerMessage =
  | { type: 'joined'; roomId: string; clientId: string; requestId?: string }
  | { type: 'pong'; requestId?: string }
  | { type: 'state'; version: number; game: unknown; requestId?: string }
  | {
      /**
       * Authoritative battle events emitted right after a turn ends or a
       * single-attack action resolves. Clients drive lane-by-lane
       * animations from this stream. `state` follows in the same flush.
       */
      type: 'battle_events'
      events: Array<{
        attacker_id: string
        from_zone: number
        defender_id: string
        to_zone: number
        damage: number
        face_damage: number
        creature_killed: boolean
        creature_damaged: boolean
      }>
      gameFinished: boolean
      winnerId: string | null
      requestId?: string
    }
  | { type: 'lobby'; lobby: unknown; requestId?: string }
  | { type: 'presence'; onlineIds: string[]; requestId?: string }
  | { type: 'closed'; reason?: string; requestId?: string }
  | { type: 'error'; code: string; message: string; requestId?: string }

/** RPC names aligned with Supabase — engine port will replace these calls in-process. */
export const GAME_ACTION_RPC: Record<string, string> = {
  play_card: 'play_card',
  draw_free: 'draw_free_card',
  draw_paid: 'draw_card_for_action',
  shuffle_deck: 'shuffle_deck',
  discard_from_hand: 'discard_from_hand',
  discard_from_zone: 'discard_from_zone',
  attack: 'perform_attack',
  flip_card: 'flip_card',
  end_turn: 'end_turn',
  forfeit: 'forfeit_game',
  reorder_lands: 'reorder_player_lands',
  confirm_land_setup: 'confirm_land_setup',
}

export type GameActionName = keyof typeof GAME_ACTION_RPC

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const data = JSON.parse(raw) as ClientMessage
    if (!data || typeof data !== 'object' || !('type' in data)) return null
    return data
  } catch {
    return null
  }
}

export function serverMsg(msg: ServerMessage): string {
  return JSON.stringify(msg)
}
