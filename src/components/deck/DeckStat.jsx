/**
 * DeckStat — показатель «Карты / Земли / Герой» в TopBar.
 *
 * Два режима:
 *   - числовой: current / max с прогресс-баром (Карты, Земли)
 *   - текстовый: text + onClick + опционально progress (Герой)
 */
export function DeckStat({
  label,
  current,
  max,
  ok,
  warn,
  // текстовый режим
  text,
  onClick,
  missing = false,
  progress = null, // 0..1, null = без шкалы
}) {
  const numeric = typeof current === 'number' && typeof max === 'number' && max > 0
  const pct = numeric ? Math.min(100, (current / max) * 100) : 0

  const stateClass = numeric
    ? ok
      ? 'deck-stat--ok'
      : warn
        ? 'deck-stat--warn'
        : ''
    : missing
      ? 'deck-stat--missing'
      : ok
        ? 'deck-stat--ok'
        : warn
          ? 'deck-stat--warn'
          : ''

  if (!numeric) {
    const fillPct = typeof progress === 'number' && progress > 0
      ? Math.min(100, Math.max(0, progress * 100))
      : 0
    return (
      <button
        type="button"
        className={`deck-stat deck-stat--clickable ${stateClass}`}
        onClick={onClick}
        aria-label={`${label}: ${text || 'не выбрано'}. Нажмите, чтобы выбрать.`}
        title={`${label}: ${text || 'не выбрано'}`}
      >
        <div className="deck-stat-head">
          <span className="deck-stat-label">{label}</span>
          <span className="deck-stat-value deck-stat-value--text">{text || '—'}</span>
        </div>
        <div className="deck-stat-track" aria-hidden="true">
          {fillPct > 0 && (
            <div className="deck-stat-fill" style={{ width: `${fillPct}%` }} />
          )}
        </div>
      </button>
    )
  }

  return (
    <div className={`deck-stat ${stateClass}`}>
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
