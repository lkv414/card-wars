/**
 * useGameAction — композитный хук для игровых действий.
 *
 * Объединяет:
 *   - useGameState (writeGameState, isApplying, error)
 *   - usePlayCard (playCard)
 *   - useAttack (attack)
 *   - useTurnControl (endTurn, forfeit)
 *
 * Обратная совместимость со старым API: { playCard, attack, endTurn, isApplying, error }.
 * Новое: добавили forfeit (Этап 3).
 *
 * Фаза 4: draw остаётся отдельным действием; скрытый auto-refill удалён.
 * Фаза 5: optimistic lock + триггеры защищают данные.
 * Фаза 6: ensureGuestId() в каждом мутирующем действии.
 */

import { useGameState } from './useGameState'
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

export function useGameAction(game, reload, { patchGame, cardCatalog, transport, suppressRealtimeReload, reloadEnabled = true } = {}) {
  const { writeGameState, isApplying, error } = useGameState(game, reload, { reloadEnabled })
  const playCard = usePlayCard(game, writeGameState, reload, { patchGame, cardCatalog, transport })
  const attack = useAttack(game, { patchGame, transport, suppressRealtimeReload })
  const drawCard = useDrawCard(game, reload, { patchGame, transport, suppressRealtimeReload })
  const drawFreeCard = useDrawFreeCard(game, reload, { patchGame, transport, suppressRealtimeReload })
  const shuffleDeck = useShuffleDeck(game, reload, { transport })
  const discardFromHand = useDiscardFromHand(game, reload, { patchGame, transport, suppressRealtimeReload })
  const discardFromZone = useDiscardFromZone(game, writeGameState, reload, { patchGame, transport, suppressRealtimeReload })
  const { endTurn, forfeit } = useTurnControl(game, writeGameState, reload, {
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
    isApplying,
    error,
  }
}