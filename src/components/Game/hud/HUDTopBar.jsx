export function HUDTopBar({ onGameEnd, logLength, onOpenReplay }) {
  return (
    <>
      <button type="button" className="exit-btn" onClick={onGameEnd}>
        ← Выйти из игры
      </button>
      <button type="button" className="replay-open-btn" onClick={onOpenReplay}>
        ⏮ Реплей ({logLength})
      </button>
    </>
  )
}
