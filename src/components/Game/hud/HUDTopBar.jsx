import { INITIAL_HEALTH } from '../../../constants/gameMultiplayer'

export function HUDTopBar({ onGameEnd, logLength, onOpenReplay, opponent }) {
  return (
    <>
      <button type="button" className="exit-btn" onClick={onGameEnd}>
        ← Выйти из игры
      </button>
      <button type="button" className="replay-open-btn" onClick={onOpenReplay}>
        ⏮ Реплей ({logLength})
      </button>
      <div className="hud-opponent">
        Противник · ❤️ {opponent.health}/{INITIAL_HEALTH} · 🂠 × {opponent.hand?.length || 0}
      </div>
    </>
  )
}
