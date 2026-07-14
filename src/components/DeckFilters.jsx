import { CARD_TYPES, LAND_TYPES } from '../constants/game'

export function DeckFilters({ filters, setFilters, mode, setMode, open, onClose }) {
  const toggle = (key, value) =>
    setFilters((prev) => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter((item) => item !== value)
        : [...prev[key], value],
    }))

  return (
    <>
      {open && <button type="button" className="filters-backdrop" aria-label="Закрыть фильтры" onClick={onClose} />}

      <aside id="deck-filters" className={`filters ${open ? 'filters-open' : ''}`}>
        <div className="filters-head">
          <h2>Фильтры</h2>
          <button type="button" className="filters-close" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        <label className="search-label">
          <span className="search-icon" aria-hidden="true">
            🔍
          </span>
          <input
            placeholder="Поиск карт..."
            value={filters.search}
            onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
          />
        </label>

        <div className="mode-tabs">
          <button type="button" className={mode === 'cards' ? 'active' : ''} onClick={() => setMode('cards')}>
            🃏 Карты
          </button>
          <button type="button" className={mode === 'lands' ? 'active' : ''} onClick={() => setMode('lands')}>
            🏞 Земли
          </button>
        </div>

        <div className="filter-block">
          <h3>Тип карты</h3>
          <div className="filter-chips">
            {Object.entries(CARD_TYPES).map(([value, label]) => (
              <label key={value} className={`filter-chip ${filters.cardTypes.includes(value) ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={filters.cardTypes.includes(value)}
                  onChange={() => toggle('cardTypes', value)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="filter-block">
          <h3>Тип земель</h3>
          <div className="filter-chips">
            {Object.entries(LAND_TYPES).map(([value, land]) => (
              <label key={value} className={`filter-chip ${filters.landTypes.includes(value) ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={filters.landTypes.includes(value)}
                  onChange={() => toggle('landTypes', value)}
                />
                <span aria-hidden="true">{land.icon}</span> {land.label}
              </label>
            ))}
          </div>
        </div>

        <div className="filter-block">
          <label className={`filter-chip ${filters.rainbow ? 'on' : ''}`}>
            <input
              type="checkbox"
              checked={filters.rainbow}
              onChange={(e) => setFilters((p) => ({ ...p, rainbow: e.target.checked }))}
            />
            🌈 Радужные
          </label>
          <label className={`filter-chip ${filters.flipOnly ? 'on' : ''}`}>
            <input
              type="checkbox"
              checked={filters.flipOnly}
              onChange={(e) => setFilters((p) => ({ ...p, flipOnly: e.target.checked }))}
            />
            С флипом
          </label>
        </div>

        <div className="filter-block">
          <h3>Стоимость</h3>
          <div className="cost-row">
            <label>
              от
              <input
                type="number"
                min="0"
                value={filters.costMin}
                onChange={(e) => setFilters((p) => ({ ...p, costMin: e.target.value }))}
              />
            </label>
            <label>
              до
              <input
                type="number"
                min="0"
                value={filters.costMax}
                onChange={(e) => setFilters((p) => ({ ...p, costMax: e.target.value }))}
              />
            </label>
          </div>
        </div>
      </aside>
    </>
  )
}
