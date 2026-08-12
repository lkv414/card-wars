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
  onEndTurn,
  onForfeit,
  onDrawCard,
}) {
  const deckCount = me.deck_pile?.length ?? me.deck_remaining ?? 0
  const discardCount = me.discard_pile?.length ?? me.discard_count ?? 0

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
            disabled={isApplying || actionsRemaining < 1 || deckCount < 1}
            onClick={(e) => {
              e.stopPropagation()
              Promise.resolve(onDrawCard?.()).catch((err) => {
                logError(err, { component: 'HUDBottomBar', action: 'drawCard' })
              })
            }}
            title="Взять 1 карту (−1 действие)"
          >
            📥 +1
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
