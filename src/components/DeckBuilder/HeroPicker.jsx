/**
 * HeroPicker — селектор героя для редактора колод.
 *
 * Показывает сетку превью всех героев; текущий выделен рамкой.
 * При выборе возвращает hero_id через onChange.
 */

export function HeroPicker({
  heroes = [],
  selectedHeroId = null,
  onChange,
  loading = false,
}) {
  if (loading) {
    return <div className="hero-picker hero-picker--loading">Загрузка героев…</div>
  }

  if (!heroes.length) {
    return <div className="hero-picker hero-picker--empty">Герои пока не загружены.</div>
  }

  return (
    <div className="hero-picker" role="radiogroup" aria-label="Выбор героя">
      <div className="hero-picker-header">
        <h3>Герой колоды</h3>
        <p className="hero-picker-hint">
          Глобальная пассивка героя действует на протяжении всей партии.
        </p>
      </div>
      <div className="hero-picker-grid">
        {heroes.map((h) => {
          const isSelected = h.id === selectedHeroId || h.number === selectedHeroId
          return (
            <button
              key={h.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={`hero-picker-card${isSelected ? ' is-selected' : ''}`}
              onClick={() => onChange?.(isSelected ? null : h.id)}
              title={h.description || h.name}
            >
              <div className="hero-picker-art">
                {h.image_url ? (
                  <img src={h.image_url} alt={h.name} draggable={false} />
                ) : (
                  <span className="hero-picker-placeholder-text">{h.name}</span>
                )}
              </div>
              <div className="hero-picker-name">{h.name}</div>
              {h.description && (
                <div className="hero-picker-desc">{h.description}</div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}