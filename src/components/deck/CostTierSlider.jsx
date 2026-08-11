const TICKS = [
  { tier: 0, label: '0' },
  { tier: 1, label: '1' },
  { tier: 2, label: '2' },
  { tier: 3, label: '3+' },
]

export function CostTierSlider({ value, onChange }) {
  const isAll = value === null
  const activeLabel = isAll ? 'Все' : value === 3 ? '3+' : String(value)
  const fillWidth = isAll ? 0 : (value / 3) * 100

  return (
    <div className={`cost-slider ${isAll ? 'cost-slider--all' : ''}`}>
      <div className="cost-slider-head">
        <span className="filter-field">Стоимость</span>
        <button
          type="button"
          className={`cost-slider-badge ${isAll ? 'is-muted' : 'is-on'}`}
          onClick={() => onChange(null)}
          title="Показать все стоимости"
          aria-pressed={isAll}
        >
          {activeLabel}
        </button>
      </div>

      <div className="cost-slider-track-wrap">
        <div className="cost-slider-track" aria-hidden="true">
          <div className="cost-slider-fill" style={{ width: `${fillWidth}%` }} />
        </div>

        <input
          type="range"
          className="cost-slider-range"
          min={0}
          max={3}
          step={1}
          value={isAll ? 0 : value}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-label="Стоимость карты"
          aria-valuetext={isAll ? 'Все стоимости' : activeLabel}
        />

        <div className="cost-slider-ticks">
          {TICKS.map(({ tier, label }) => {
            const on = value === tier
            return (
              <button
                key={label}
                type="button"
                className={`cost-slider-tick ${on ? 'is-on' : ''}`}
                aria-pressed={on}
                aria-label={`Стоимость ${label}`}
                onClick={() => onChange(on ? null : tier)}
              >
                <span className="cost-slider-dot" aria-hidden="true" />
                <span className="cost-slider-label">{label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
