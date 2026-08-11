import { INITIAL_HEALTH } from '../../../constants/gameMultiplayer'
import { logError } from '../../../utils/errorLogger'

export function HUDBottomBar({
  isYourTurn,
  isFinished,
  winnerId,
  playerId,
  me,
  isApplying,
  onEndTurn,
  onForfeit,
}) {
  return (
    <div className={`hud-bottom-status ${isYourTurn ? 'your' : 'opponent'} ${isFinished ? 'finished' : ''}`}>
      {isFinished
        ? `🎉 ${winnerId === playerId ? 'Вы выиграли!' : 'Вы проиграли!'}`
        : isYourTurn
          ? '👉 Ваш ход'
          : '⏳ Ход противника'}
      <span className="hud-bottom-stats">
        ❤️ {me.health}/{INITIAL_HEALTH} · 📚 {me.deck_pile?.length ?? me.deck_remaining ?? 0}
      </span>
      {isYourTurn && !isFinished && (
        <div className="hud-bottom-buttons">
          <button
            type="button"
            className="hud-end-btn"
            disabled={isApplying}
            onClick={(e) => {
              e.stopPropagation()
              Promise.resolve(onEndTurn?.()).catch((err) => {
                logError(err, { component: 'HUDBottomBar', action: 'endTurn' })
              })
            }}
            title="Завершает ваш ход. Переходит к следующему игроку и добирает 1 карту."
          >
            {isApplying ? '⏳ Отправка…' : '⏭ Закончить ход'}
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
            title="Сдаться — оппонент победит"
          >
            🏳️ Сдаться
          </button>
        </div>
      )}
    </div>
  )
}
