export function DeckStat({ label, current, max, ok, warn }) {
  const pct = Math.min(100, (current / max) * 100)
  return (
    <div className={`deck-stat ${ok ? 'deck-stat--ok' : warn ? 'deck-stat--warn' : ''}`}>
      <div className="deck-stat-head">
        <span className="deck-stat-label">{label}</span>
        <span className="deck-stat-value">
          {current}
          <span className="deck-stat-max">/{max}</span>
        </span>
      </div>
      <div className="deck-stat-track" aria-hidden="true">
        <div className="deck-stat-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
