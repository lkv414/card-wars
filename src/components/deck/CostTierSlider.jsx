const TICKS = [
  { tier: 0, label: '0' },
  { tier: 1, label: '1' },
  { tier: 2, label: '2' },
  { tier: 3, label: '3+' },
]

export function CostTierSlider({ value, onChange }) {
  const sliderValue = value === null ? 0 : value
  const activeLabel =
    value === null ? 'Все' : value === 3 ? '3+' : String(value)

  const handleRange = (event) => {
    const tier = Number(event.target.value)
    onChange(tier)
  }

  return (
    <div className="cost-slider">
      <div className="cost-slider-head">
        <span className="filter-field">Стоимость</span>
        <button
          type="button"
          className={`cost-slider-badge ${value === null ? 'is-muted' : 'is-on'}`}
          onClick={() => onChange(null)}
          title="Показать все стоимости"
        >
          {activeLabel}
        </button>
      </div>

      <div className="cost-slider-track-wrap">
        <div className="cost-slider-track" aria-hidden="true">
          <div
            className="cost-slider-fill"
            style={{
              width: value === null ? '0%' : `${(sliderValue / 3) * 100}%`,
            }}
          />
        </div>

        <input
          type="range"
          className="cost-slider-range"
          min={0}
          max={3}
          step={1}
          value={sliderValue}
          onChange={handleRange}
          aria-label="Стоимость карты"
          aria-valuetext={activeLabel}
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
