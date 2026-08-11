import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DECK_LIMITS } from '../constants/game'

const { cards: CARD_LIMITS, lands: LAND_LIMITS } = DECK_LIMITS

function DeckStat({ label, current, max, ok, warn }) {
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

export function TopBar({
  deckCode,
  cardTotal,
  landTotal,
  errors,
  warnings,
  importDeck,
  filtersOpen,
  onToggleFilters,
  onCopyCode,
}) {
  const navigate = useNavigate()
  const [codeDraft, setCodeDraft] = useState('')
  const [isEditingCode, setIsEditingCode] = useState(false)
  const codeInputValue = isEditingCode ? codeDraft : deckCode

  const cardsOk = cardTotal === CARD_LIMITS.maxTotal
  const landsOk = landTotal === LAND_LIMITS.maxTotal
  const cardsWarn = errors.some((e) => e.includes('карт'))
  const hasMessages = warnings.length > 0 || errors.length > 0

  const handleCodeKeyDown = (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    const normalizedCode = codeInputValue.trim()
    setCodeDraft(normalizedCode)
    setIsEditingCode(false)
    if (normalizedCode) importDeck(normalizedCode)
  }

  return (
    <header className="deck-header">
      <div className="deck-header-row">
        <div className="deck-header-start">
          <button type="button" className="deck-icon-btn" onClick={() => navigate('/')} aria-label="Назад">
            ←
          </button>
          <div className="deck-header-brand">
            <h1>Редактор колод</h1>
          </div>
        </div>

        <div className="deck-header-stats" aria-label="Прогресс колоды">
          <DeckStat
            label="Карты"
            current={cardTotal}
            max={CARD_LIMITS.maxTotal}
            ok={cardsOk}
            warn={cardsWarn}
          />
          <DeckStat
            label="Земли"
            current={landTotal}
            max={LAND_LIMITS.maxTotal}
            ok={landsOk}
            warn={!landsOk && (landTotal > 0 || errors.length > 0)}
          />
        </div>

        <div className="deck-header-code">
          <label className="visually-hidden" htmlFor="deck-code-input">
            Код колоды
          </label>
          <div className="deck-code-input">
            <input
              id="deck-code-input"
              placeholder="Код колоды — Enter для импорта"
              value={codeInputValue}
              onFocus={(event) => {
                const input = event.currentTarget
                setCodeDraft(deckCode)
                setIsEditingCode(true)
                requestAnimationFrame(() => input.select())
              }}
              onBlur={() => setIsEditingCode(false)}
              onChange={(e) => setCodeDraft(e.target.value)}
              onKeyDown={handleCodeKeyDown}
            />
            <button
              type="button"
              className="deck-icon-btn deck-icon-btn--accent"
              aria-label="Скопировать код колоды"
              disabled={!deckCode}
              onClick={() => onCopyCode?.(deckCode)}
            >
              ⧉
            </button>
          </div>
        </div>

        <button
          type="button"
          className={`deck-filters-btn ${filtersOpen ? 'is-active' : ''}`}
          onClick={onToggleFilters}
          aria-expanded={filtersOpen}
          aria-controls="deck-filters"
        >
          Фильтры
        </button>
      </div>

      {hasMessages && (
        <div className="deck-header-alerts" role="status" aria-live="polite">
          {warnings.map((w) => (
            <span className="deck-alert deck-alert--warn" key={w}>
              {w}
            </span>
          ))}
          {errors.map((e) => (
            <span className="deck-alert deck-alert--err" key={e}>
              {e}
            </span>
          ))}
        </div>
      )}
    </header>
  )
}
