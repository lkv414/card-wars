/**
 * useGameAction — композитный хук для игровых действий.
 *
 * Объединяет per-action хуки (playCard/attack/endTurn/draw/…). Каждое действие
 * уходит по WebSocket в GameRoom Durable Object — Worker единственный авторитет,
 * SQL-пути больше нет (Этап 6 плана v2).
 *
 * Ошибки и «идёт применение» приходят из двух источников, поэтому хук их не
 * дублирует:
 *   - результат действия — `{ error }` из самого per-action хука (GameScreen
 *     показывает его тостом);
 *   - версия/оптимистичные патчи — `gameStore` (`selectError`, `selectIsApplying`).
 */

import { usePlayCard } from './usePlayCard'
import { useAttack } from './useAttack'
import { useTurnControl } from './useTurnControl'
import { useFlipCard } from './useFlipCard'
import { useDiscardFromZone } from './useDiscardFromZone'
import { useDrawCard } from './useDrawCard'
import { useDrawFreeCard } from './useDrawFreeCard'
import { useShuffleDeck } from './useShuffleDeck'
import { useDiscardFromHand } from './useDiscardFromHand'
import { useAbility } from './useAbility'

export function useGameAction(game, { patchGame, cardCatalog, transport, suppressRealtimeReload } = {}) {
  const playCard = usePlayCard(game, { patchGame, cardCatalog, transport })
  const attack = useAttack(game, { patchGame, transport, suppressRealtimeReload })
  const drawCard = useDrawCard(game, { patchGame, transport, suppressRealtimeReload })
  const drawFreeCard = useDrawFreeCard(game, { patchGame, transport, suppressRealtimeReload })
  const shuffleDeck = useShuffleDeck(game, { transport })
  const discardFromHand = useDiscardFromHand(game, { patchGame, transport, suppressRealtimeReload })
  const discardFromZone = useDiscardFromZone(game, { patchGame, transport, suppressRealtimeReload })
  const { endTurn, forfeit } = useTurnControl(game, {
    patchGame,
    transport,
    suppressRealtimeReload,
  })
  const flipCard = useFlipCard(game, { patchGame, transport, suppressRealtimeReload })
  const useAbilityAction = useAbility(game, { transport, suppressRealtimeReload })

  return {
    playCard,
    attack,
    drawCard,
    drawFreeCard,
    shuffleDeck,
    discardFromHand,
    discardFromZone,
    endTurn,
    forfeit,
    flipCard,
    useAbility: useAbilityAction,
  }
}
