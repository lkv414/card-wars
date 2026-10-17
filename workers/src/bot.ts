/**
 * bot.ts — серверный псевдо-игрок для GameRoom.
 *
 * Бот живёт внутри Durable Object: он не клиент и не отдельный процесс, а
 * «решатель» — на своём ходу комнате нужно получить ровно одно действие.
 * Поэтому здесь только чистая функция `chooseBotAction(state, botId)`, а
 * темп/анимация/бродкаст — забота GameRoom (alarm по BOT_STEP_MS).
 *
 * Правила не дублируются: кандидаты собираются, а решает `validateAction` из
 * движка. Это значит, что бот физически не может сделать нелегальный ход, и
 * при изменении правил правится одно место (движок), а не бот.
 */
import { validateAction } from './game-engine/validation'
import type { Action, Card, GameState, PlayerState } from './game-engine/types'

export const BOT_NICKNAME = 'Бот'

/** Zone slots on a board (1..4). */
const ZONE_POSITIONS = [1, 2, 3, 4]

export function isBotSeat(player: Pick<PlayerState, 'is_bot'>): boolean {
  return player.is_bot === true
}

/** The bot's player id in this game, or null when the game has no bot. */
export function findBotId(state: GameState): string | null {
  return state.players.find((player) => isBotSeat(player))?.player_id ?? null
}

function costOf(state: GameState, card: Card): number {
  const fromCatalog = state.catalog?.[card.id]?.cost
  if (typeof fromCatalog === 'number') return fromCatalog
  return typeof card.cost === 'number' ? card.cost : 1
}

/**
 * Candidate plays, cheapest first — the bot spends its 2 action points on
 * several small cards rather than one big one, which keeps more lanes busy.
 * Creatures win ties over buildings (buildings don't attack).
 */
function playCandidates(state: GameState, me: PlayerState): Action[] {
  const plays: { action: Action; cost: number; building: number; cardIndex: number }[] = []
  me.hand.forEach((card, cardIndex) => {
    const building = card.card_type === 'building' ? 1 : 0
    const cost = costOf(state, card)
    for (const zonePosition of ZONE_POSITIONS) {
      plays.push({
        action: { type: 'play_card', cardIndex, zonePosition },
        cost,
        building,
        cardIndex,
      })
    }
  })
  plays.sort((a, b) => a.cost - b.cost || a.building - b.building || a.cardIndex - b.cardIndex)
  return plays.map((entry) => entry.action)
}

/**
 * Attack candidates: every untapped creature on every lane against every
 * opponent lane. `validateAction` narrows this to the one legal target per lane.
 */
function attackCandidates(state: GameState, me: PlayerState): Action[] {
  const attacks: Action[] = []
  const opponents = state.players.filter(
    (player) => player.player_id !== me.player_id && (player.health ?? 0) > 0,
  )
  for (const zone of me.zones) {
    for (const card of zone.cards) {
      if (card.tapped) continue
      const attackerCardId = String(card.instanceId ?? card.id)
      for (const opponent of opponents) {
        for (const toZone of ZONE_POSITIONS) {
          attacks.push({
            type: 'attack',
            fromZone: zone.zone_position,
            attackerCardId,
            toPlayerId: opponent.player_id,
            toZone,
          })
        }
      }
    }
  }
  return attacks
}

/**
 * One action for the bot, or `null` when it is not the bot's turn.
 *
 * Priority: free draw (card advantage, no AP) → play (cheapest first) →
 * attack → end turn. `end_turn` is last and always legal, so the caller always
 * gets a terminating move when it is the bot's turn.
 */
export function chooseBotAction(state: GameState, botId: string): Action | null {
  if (state.status !== 'active') return null
  if (state.current_player_id !== botId) return null
  const me = state.players.find((player) => player.player_id === botId)
  if (!me || (me.health ?? 0) <= 0) return null

  const candidates: Action[] = [
    { type: 'draw_free' },
    ...playCandidates(state, me),
    ...attackCandidates(state, me),
    { type: 'end_turn' },
  ]

  for (const candidate of candidates) {
    if (validateAction(state, candidate, botId).ok) return candidate
  }
  return { type: 'end_turn' }
}
