import { CARD_TYPES, LAND_TYPES } from '../../constants/game'
import { hasActiveAdminFilters } from '../../utils/adminCardValidation'
import { toggleFilterList } from '../../utils/filterState'
import { CostTierSlider } from '../deck/CostTierSlider'

const SORT_OPTIONS = [
  { value: 'number', label: 'Номер' },
  { value: 'cost', label: 'Стоимость' },
  { value: 'name', label: 'Имя' },
  { value: 'type', label: 'Тип' },
]

const SEVERITY_OPTIONS = [
  { value: 'all', label: 'Все карты' },
  { value: 'error', label: 'Только ошибки' },
  { value: 'warning', label: 'Ошибки + предупреждения' },
]

export function AdminFilters({ filters, setFilters, open, onClose, onReset, stats }) {
  const toggleList = (key, value) => setFilters((prev) => toggleFilterList(prev, key, value))
  const active = hasActiveAdminFilters(filters)

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

      <aside
        id="admin-filters"
        className={`deck-filters admin-filters ${open ? 'is-open' : ''}`}
        aria-label="Фильтры каталога"
      >
        <div className="deck-filters-head">
          <h2>Фильтры</h2>
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

        {stats && (
          <div className="admin-filter-stats">
            <span className="admin-stat admin-stat--ok">{stats.clean} OK</span>
            <span className="admin-stat admin-stat--warn">{stats.warnings} ⚠</span>
            <span className="admin-stat admin-stat--err">{stats.errors} !</span>
          </div>
        )}

        <div className="deck-filters-body">
          <div className="filter-section filter-section--search">
            <label className="visually-hidden" htmlFor="admin-search">
              Поиск
            </label>
            <input
              id="admin-search"
              className="filter-input"
              placeholder="Имя, описание, №…"
              value={filters.search}
              onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
            />
          </div>

          <div className="filter-section">
            <label className="filter-field" htmlFor="admin-sort">
              Сортировка
            </label>
            <select
              id="admin-sort"
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

          <div className="filter-section admin-filter-section--issues">
            <span className="filter-field">Качество данных</span>
            <div className="filter-stack">
              {SEVERITY_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`filter-pill ${filters.issueSeverity === opt.value ? 'is-on' : ''}`}
                >
                  <input
                    type="radio"
                    name="issueSeverity"
                    checked={filters.issueSeverity === opt.value}
                    onChange={() => setFilters((p) => ({ ...p, issueSeverity: opt.value }))}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            <label className="filter-switch admin-filter-switch">
              <span className="filter-switch-label">Только с замечаниями</span>
              <input
                type="checkbox"
                checked={Boolean(filters.anomaliesOnly)}
                onChange={(e) => setFilters((p) => ({ ...p, anomaliesOnly: e.target.checked }))}
              />
              <span className="filter-switch-track" aria-hidden="true" />
            </label>
            <label className="filter-switch admin-filter-switch">
              <span className="filter-switch-label">Без изображения</span>
              <input
                type="checkbox"
                checked={Boolean(filters.missingImage)}
                onChange={(e) => setFilters((p) => ({ ...p, missingImage: e.target.checked }))}
              />
              <span className="filter-switch-track" aria-hidden="true" />
            </label>
            <label className="filter-switch admin-filter-switch">
              <span className="filter-switch-label">Без описания</span>
              <input
                type="checkbox"
                checked={Boolean(filters.missingDescription)}
                onChange={(e) => setFilters((p) => ({ ...p, missingDescription: e.target.checked }))}
              />
              <span className="filter-switch-track" aria-hidden="true" />
            </label>
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
        </div>
      </aside>
    </>
  )
}
