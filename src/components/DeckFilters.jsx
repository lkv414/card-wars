import { CARD_TYPES, LAND_TYPES } from '../constants/game'
import { hasActiveFilters } from '../utils/cardSort'

const COST_OPTIONS = [0, 1, 2, 3, 4, 5, 6]
const SORT_OPTIONS = [
  { value: 'number', label: 'Номер' },
  { value: 'cost', label: 'Стоимость' },
  { value: 'name', label: 'Имя' },
  { value: 'type', label: 'Тип' },
]

export function DeckFilters({
  filters,
  setFilters,
  mode,
  setMode,
  open,
  onClose,
  onReset,
}) {
  const toggle = (key, value) =>
    setFilters((prev) => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter((item) => item !== value)
        : [...prev[key], value],
    }))

  const toggleCost = (value) =>
    setFilters((prev) => {
      const costs = prev.costs || []
      return {
        ...prev,
        costs: costs.includes(value) ? costs.filter((c) => c !== value) : [...costs, value],
      }
    })

  const active = hasActiveFilters(filters)

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

      <aside id="deck-filters" className={`filters ${open ? 'filters-open' : ''}`}>
        <div className="filters-head">
          <h2>Фильтры</h2>
          <div className="filters-head-actions">
            {active && (
              <button type="button" className="filters-reset" onClick={onReset}>
                Сбросить
              </button>
            )}
            <button type="button" className="filters-close" onClick={onClose} aria-label="Закрыть">
              ✕
            </button>
          </div>
        </div>

        <div className="filters-title-row">
          <h2 className="filters-title-desktop">Фильтры</h2>
          {active && (
            <button type="button" className="filters-reset filters-reset-desktop" onClick={onReset}>
              Сбросить
            </button>
          )}
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
          <button
            type="button"
            className={mode === 'cards' ? 'active' : ''}
            onClick={() => setMode('cards')}
          >
            Карты
          </button>
          <button
            type="button"
            className={mode === 'lands' ? 'active' : ''}
            onClick={() => setMode('lands')}
          >
            Земли
          </button>
        </div>

        <div className="filter-block">
          <h3>Сортировка</h3>
          <div className="sort-row">
            <select
              aria-label="Сортировка карт"
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
              <label
                key={value}
                className={`filter-chip ${filters.landTypes.includes(value) ? 'on' : ''}`}
              >
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
            Радужные
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
          <div className="filter-chips cost-chips">
            {COST_OPTIONS.map((value) => {
              const label = value === 6 ? '6+' : String(value)
              const on = (filters.costs || []).includes(value)
              return (
                <label key={value} className={`filter-chip cost-chip ${on ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleCost(value)}
                  />
                  {label}
                </label>
              )
            })}
          </div>
        </div>
      </aside>
    </>
  )
}
