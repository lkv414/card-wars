import { useState } from 'react'
import { navigate, ROUTES } from '../router'

export function TopBar({
  deckCode,
  cardTotal,
  landTotal,
  errors,
  warnings,
  importDeck,
  filtersOpen,
  onToggleFilters,
}) {
  const [codeDraft, setCodeDraft] = useState('')
  const [isEditingCode, setIsEditingCode] = useState(false)
  const codeInputValue = isEditingCode ? codeDraft : deckCode

  const cardsOk = cardTotal === 40
  const landsOk = landTotal === 4
  const tallyClass = [
    'deck-tally',
    errors.length ? 'invalid' : cardsOk && landsOk ? 'ok' : cardsOk || landTotal > 0 ? 'partial' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const handleCodeKeyDown = (event) => {
    if (event.key !== 'Enter') return

    event.preventDefault()
    const normalizedCode = codeInputValue.trim()
    setCodeDraft(normalizedCode)
    setIsEditingCode(false)

    if (normalizedCode) {
      importDeck(normalizedCode)
    }
  }

  return (
    <header className="topbar">
      <button type="button" className="back-btn" onClick={() => navigate(ROUTES.menu)}>
        ← Назад
      </button>

      <button
        type="button"
        className={`filters-toggle ${filtersOpen ? 'active' : ''}`}
        onClick={onToggleFilters}
        aria-expanded={filtersOpen}
        aria-controls="deck-filters"
      >
        {filtersOpen ? '✕ Фильтры' : '☰ Фильтры'}
      </button>

      <span className={tallyClass} title="Карты | Земли">
        <span className={cardsOk ? 'tally-ok' : errors.some((e) => e.includes('карт')) ? 'tally-bad' : ''}>
          {cardTotal} / 40
        </span>
        <span className="tally-sep" aria-hidden="true">
          |
        </span>
        <span className={landsOk ? 'tally-ok' : 'tally-bad'}>{landTotal} / 4</span>
      </span>


      <input
        aria-label="Live-код колоды или код для загрузки"
        className="code-input"
        placeholder="Код DK-XXXXXX"
        title="Live-код текущей колоды. Вставьте другой код и нажмите Enter, чтобы загрузить колоду."
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



      {(warnings.length > 0 || errors.length > 0) && (
        <div className="validation">
          {warnings.map((w) => (
            <span className="warn" key={w}>
              ⚠️ {w}
            </span>
          ))}
          {errors.map((e) => (
            <span className="err" key={e}>
              ❌ {e}
            </span>
          ))}
        </div>
      )}
    </header>
  )
}
