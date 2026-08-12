import { INITIAL_HEALTH } from '../../../constants/gameMultiplayer'
import { logError } from '../../../utils/errorLogger'

export function HUDBottomBar({
  isYourTurn,
  isFinished,
  winnerId,
  playerId,
  me,
  actionsRemaining = 2,
  canDealDamage = true,
  isApplying,
  freeDrawUsed = false,
  paidDrawUsed = false,
  onEndTurn,
  onForfeit,
  onDrawFreeCard,
  onDrawPaidCard,
  onShuffleDeck,
}) {
  const deckCount = me.deck_pile?.length ?? me.deck_remaining ?? 0
  const discardCount = me.discard_pile?.length ?? me.discard_count ?? 0
  const canDrawFromPile = deckCount > 0 || discardCount > 0

  const drawLabel = !freeDrawUsed
    ? '📥 Бесплатная карта'
    : !paidDrawUsed
      ? '📥 +1 (−1 ⚡)'
      : '📥 использовано'

  const drawDisabled =
    isApplying
    || (freeDrawUsed && paidDrawUsed)
    || (!freeDrawUsed ? !canDrawFromPile : actionsRemaining < 1 || !canDrawFromPile)

  const drawTitle = !freeDrawUsed
    ? 'Взять 1 бесплатную карту (1 раз за ход)'
    : !paidDrawUsed
      ? 'Взять 1 карту за 1 действие (1 раз за ход)'
      : 'Добор уже использован в этом ходу'

  const handleDraw = () => {
    if (!freeDrawUsed) return onDrawFreeCard?.()
    if (!paidDrawUsed) return onDrawPaidCard?.()
    return Promise.resolve()
  }

  return (
    <div className={`hud-bottom-status ${isYourTurn ? 'your' : 'opponent'} ${isFinished ? 'finished' : ''}`}>
      <div className="hud-resource-stack" aria-label="Колода и сброс">
        <div className="hud-resource hud-resource--deck" title="Колода">
          <span className="hud-resource-icon" aria-hidden>📚</span>
          <span className="hud-resource-count">{deckCount}</span>
        </div>
        <div className="hud-resource hud-resource--discard" title="Сброс">
          <span className="hud-resource-icon" aria-hidden>🗑️</span>
          <span className="hud-resource-count">{discardCount}</span>
        </div>
      </div>

      <div className="hud-turn-banner">
        {isFinished
          ? `🎉 ${winnerId === playerId ? 'Вы выиграли!' : 'Вы проиграли!'}`
          : isYourTurn
            ? '👉 Ваш ход'
            : '⏳ Ход противника'}
        <span className="hud-health-pill">
          ❤️ {me.health}/{INITIAL_HEALTH}
        </span>
        {isYourTurn && !isFinished && (
          <span className="hud-actions-pill" title="Действия на ход">
            ⚡ {actionsRemaining}/2
          </span>
        )}
        {!canDealDamage && isYourTurn && !isFinished && (
          <span className="hud-no-damage-pill" title="Урон недоступен на первом круге">
            🛡️ без урона
          </span>
        )}
      </div>

      {isYourTurn && !isFinished && (
        <div className="hud-bottom-buttons">
          <button
            type="button"
            className="hud-draw-btn"
            disabled={drawDisabled}
            onClick={(e) => {
              e.stopPropagation()
              Promise.resolve(handleDraw()).catch((err) => {
                logError(err, { component: 'HUDBottomBar', action: 'drawCard' })
              })
            }}
            title={drawTitle}
          >
            {drawLabel}
          </button>
          <button
            type="button"
            className="hud-shuffle-btn"
            disabled={isApplying || (deckCount + (me.hand?.length ?? 0) < 1 && discardCount < 1)}
            onClick={(e) => {
              e.stopPropagation()
              Promise.resolve(onShuffleDeck?.()).catch((err) => {
                logError(err, { component: 'HUDBottomBar', action: 'shuffleDeck' })
              })
            }}
            title="Перемешать руку и колоду (сброс → колода если колода пуста)"
          >
            🔀
          </button>
          <button
            type="button"
            className="hud-battle-btn"
            disabled={isApplying}
            onClick={(e) => {
              e.stopPropagation()
              Promise.resolve(onEndTurn?.()).catch((err) => {
                logError(err, { component: 'HUDBottomBar', action: 'endTurn' })
              })
            }}
            title="Завершить ход и перейти к фазе боя"
          >
            {isApplying ? '⏳ …' : '⚔️ BATTLE!'}
          </button>
          <button
            type="button"
            className="hud-forfeit-btn"
            disabled={isApplying}
            onClick={(e) => {
              e.stopPropagation()
              Promise.resolve(onForfeit?.()).catch((err) => {
                logError(err, { component: 'HUDBottomBar', action: 'forfeit' })
              })
            }}
            title="Сдаться"
          >
            🏳️
          </button>
        </div>
      )}
    </div>
  )
}
