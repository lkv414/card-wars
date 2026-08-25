import { hasActiveFilters } from '../../utils/cardSort'

const RESULT_LABEL = {
  cards: ['карта', 'карты', 'карт'],
  lands: ['земля', 'земли', 'земель'],
  heroes: ['герой', 'героя', 'героев'],
}

function pluralize(count, [one, few, many]) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

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
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'heroes'}
          className={mode === 'heroes' ? 'is-active' : ''}
          onClick={() => setMode('heroes')}
        >
          Герои
        </button>
      </div>

      <p className="library-meta">
        {resultCount} {pluralize(resultCount, RESULT_LABEL[mode] || RESULT_LABEL.cards)}
      </p>

      {active && (
        <button type="button" className="deck-link-btn library-reset" onClick={onResetFilters}>
          Сбросить фильтры
        </button>
      )}
    </div>
  )
}
