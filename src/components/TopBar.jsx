import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DECK_LIMITS } from '../constants/game'
import { DeckStat } from './deck/DeckStat'

const { cards: CARD_LIMITS, lands: LAND_LIMITS } = DECK_LIMITS

export function TopBar({
  deckCode,
  cardTotal,
  landTotal,
  heroLabel,
  heroMissing,
  heroProgress,
  onOpenHeroes,
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
          <button type="button" className="deck-icon-btn" onClick={() => navigate('/decks')} aria-label="Назад к колодам">
            ←
          </button>
          <div className="deck-header-brand">
            <span className="deck-header-eyebrow">Колода</span>
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
          <DeckStat
            label="Герой"
            text={heroLabel || 'Выберите героя'}
            onClick={onOpenHeroes}
            missing={heroMissing}
            progress={heroProgress}
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
