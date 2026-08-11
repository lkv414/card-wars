import { CARD_TYPES, LAND_TYPES } from '../constants/game'
import { hasActiveFilters } from '../utils/cardSort'
import { CostTierSlider } from './deck/CostTierSlider'

const SORT_OPTIONS = [
  { value: 'number', label: 'Номер' },
  { value: 'cost', label: 'Стоимость' },
  { value: 'name', label: 'Имя' },
  { value: 'type', label: 'Тип' },
]

export function DeckFilters({ filters, setFilters, mode, open, onClose, onReset }) {
  const toggleList = (key, value) =>
    setFilters((prev) => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter((item) => item !== value)
        : [...prev[key], value],
    }))

  const active = hasActiveFilters(filters)
  const isLands = mode === 'lands'

  return (
    <>
      {open && (
        <button
          type="button"
          className="filters-backdrop"
          aria-label="Закрыть фильтры"
          onClick={onClose}
        />
      )}

      <aside id="deck-filters" className={`deck-filters ${open ? 'is-open' : ''}`} aria-label="Фильтры">
        <div className="deck-filters-head">
          <h2>{isLands ? 'Поиск земель' : 'Фильтры'}</h2>
          <div className="deck-filters-head-actions">
            {active && (
              <button type="button" className="deck-link-btn" onClick={onReset}>
                Сбросить
              </button>
            )}
            <button type="button" className="deck-filters-close" onClick={onClose} aria-label="Закрыть">
              ✕
            </button>
          </div>
        </div>

        <div className="deck-filters-body">
          <div className="filter-section filter-section--search">
            <label className="visually-hidden" htmlFor="deck-search">
              {isLands ? 'Поиск земли' : 'Поиск'}
            </label>
            <input
              id="deck-search"
              className="filter-input"
              placeholder={isLands ? 'Поиск земли...' : 'Поиск...'}
              value={filters.search}
              onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
            />
          </div>

          {!isLands && (
            <>
              <div className="filter-section">
                <label className="filter-field" htmlFor="deck-sort">
                  Сортировка
                </label>
                <select
                  id="deck-sort"
                  className="filter-input"
                  value={filters.sort || 'number'}
                  onChange={(e) => setFilters((p) => ({ ...p, sort: e.target.value }))}
                >
                  {SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filter-section">
                <span className="filter-field">Тип</span>
                <div className="filter-stack">
                  {Object.entries(CARD_TYPES).map(([value, label]) => (
                    <label
                      key={value}
                      className={`filter-pill ${filters.cardTypes.includes(value) ? 'is-on' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={filters.cardTypes.includes(value)}
                        onChange={() => toggleList('cardTypes', value)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="filter-section">
                <span className="filter-field">Земля карты</span>
                <div className="filter-grid filter-grid--2">
                  {Object.entries(LAND_TYPES).map(([value, land]) => (
                    <label
                      key={value}
                      className={`filter-pill filter-pill--land ${filters.landTypes.includes(value) ? 'is-on' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={filters.landTypes.includes(value)}
                        onChange={() => toggleList('landTypes', value)}
                      />
                      <span className="filter-pill-icon" aria-hidden="true">
                        {land.icon}
                      </span>
                      <span className="filter-pill-text">{land.shortLabel}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="filter-section filter-section--flush">
                <CostTierSlider
                  value={filters.costTier ?? null}
                  onChange={(costTier) => setFilters((p) => ({ ...p, costTier }))}
                />
              </div>

              <label className="filter-switch">
                <span className="filter-switch-label">Только с флипом</span>
                <input
                  type="checkbox"
                  checked={Boolean(filters.flipOnly)}
                  onChange={(e) => setFilters((p) => ({ ...p, flipOnly: e.target.checked }))}
                />
                <span className="filter-switch-track" aria-hidden="true" />
              </label>
            </>
          )}
        </div>
      </aside>
    </>
  )
}
