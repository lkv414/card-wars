import { hasActiveFilters } from '../../utils/cardSort'

export function LibraryToolbar({ mode, setMode, resultCount, filters, onResetFilters }) {
  const active = hasActiveFilters(filters)

  return (
    <div className="library-toolbar">
      <div className="library-segment" role="tablist" aria-label="Раздел библиотеки">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'cards'}
          className={mode === 'cards' ? 'is-active' : ''}
          onClick={() => setMode('cards')}
        >
          Карты
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'lands'}
          className={mode === 'lands' ? 'is-active' : ''}
          onClick={() => setMode('lands')}
        >
          Земли
        </button>
      </div>

      <p className="library-meta">
        {resultCount} {mode === 'cards' ? 'карт' : 'земель'}
      </p>

      {active && (
        <button type="button" className="deck-link-btn library-reset" onClick={onResetFilters}>
          Сбросить фильтры
        </button>
      )}
    </div>
  )
}
