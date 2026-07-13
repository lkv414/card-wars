import { CARD_TYPES, LAND_TYPES } from '../constants/game'

export function DeckFilters({ filters, setFilters, mode, setMode }) {
  const toggle = (key, value) =>
    setFilters((prev) => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter((item) => item !== value)
        : [...prev[key], value],
    }))

  return (
    <aside className="filters">
      <label className="search-label">
        🔍
        <input
          placeholder="Поиск карт..."
          value={filters.search}
          onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
        />
      </label>

      <div className="mode-tabs">
        <button
          className={mode === 'cards' ? 'active' : ''}
          onClick={() => setMode('cards')}
        >
          🃏 Карты
        </button>
        <button
          className={mode === 'lands' ? 'active' : ''}
          onClick={() => setMode('lands')}
        >
          🏞 Земли
        </button>
      </div>

      <h3>Тип карты</h3>
      {Object.entries(CARD_TYPES).map(([value, label]) => (
        <label key={value}>
          <input
            type="checkbox"
            checked={filters.cardTypes.includes(value)}
            onChange={() => toggle('cardTypes', value)}
          />{' '}
          {label}
        </label>
      ))}

      <h3>Тип земель</h3>
      {Object.entries(LAND_TYPES).map(([value, land]) => (
        <label key={value}>
          <input
            type="checkbox"
            checked={filters.landTypes.includes(value)}
            onChange={() => toggle('landTypes', value)}
          />{' '}
          {land.icon} {land.label}
        </label>
      ))}

      <label>
        <input
          type="checkbox"
          checked={filters.rainbow}
          onChange={(e) => setFilters((p) => ({ ...p, rainbow: e.target.checked }))}
        />{' '}
        🌈 Радужные карты
      </label>

      <h3>Стоимость</h3>
      <div className="cost-row">
        <input
          type="number"
          value={filters.costMin}
          onChange={(e) => setFilters((p) => ({ ...p, costMin: e.target.value }))}
        />
        <input
          type="number"
          value={filters.costMax}
          onChange={(e) => setFilters((p) => ({ ...p, costMax: e.target.value }))}
        />
      </div>

      <label>
        <input
          type="checkbox"
          checked={filters.flipOnly}
          onChange={(e) => setFilters((p) => ({ ...p, flipOnly: e.target.checked }))}
        />{' '}
        Только с флюпом
      </label>
    </aside>
  )
}

