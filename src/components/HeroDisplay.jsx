/**
 * HeroDisplay — компактный показ героя колоды/лобби:
 * - hover/focus → всплывает краткое описание героя (tooltip)
 * - click → открывает HeroPanel (имя сверху по центру,
 *   картинка на левой половине, описание на правой)
 *
 * Используется в LobbyScreen и DeckList.
 */

import { useEffect, useId, useRef, useState } from 'react'

export function HeroDisplay({ hero, label = null, align = 'right' }) {
  const [panelOpen, setPanelOpen] = useState(false)
  const openerRef = useRef(null)
  const panelRef = useRef(null)
  const nameId = useId()
  const tipId = useId()

  // Закрытие по Escape
  useEffect(() => {
    if (!panelOpen) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setPanelOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panelOpen])

  // Фокус в диалог при открытии, возврат к кнопке при закрытии
  useEffect(() => {
    if (!panelOpen) return undefined
    const previous = document.activeElement
    panelRef.current?.focus()
    return () => {
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [panelOpen])

  if (!hero) return null

  const name = label || hero.name || 'Герой'
  const hasArt = Boolean(hero.image_url)

  return (
    <span className={`hero-display hero-display--${align}`}>
      <button
        ref={openerRef}
        type="button"
        className="hero-display__btn"
        onClick={(e) => {
          e.stopPropagation()
          setPanelOpen(true)
        }}
        aria-haspopup="dialog"
        aria-expanded={panelOpen}
        aria-label={`Открыть описание героя: ${name}`}
        aria-describedby={hero.description ? tipId : undefined}
      >
        {name}
      </button>

      {hero.description && (
        <span className="hero-display__tip" role="tooltip" id={tipId} aria-hidden="true">
          {hero.description}
        </span>
      )}

      {panelOpen && (
        <div className="hero-panel-backdrop" onClick={() => setPanelOpen(false)}>
          <div
            ref={panelRef}
            className="hero-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={nameId}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="hero-panel__title" id={nameId}>
              {name}
            </h3>
            <div className="hero-panel__body">
              <div className="hero-panel__art">
                {hasArt ? (
                  <img src={hero.image_url} alt={name} draggable={false} />
                ) : (
                  <span className="hero-panel__placeholder">Нет изображения</span>
                )}
              </div>
              <p className="hero-panel__desc">{hero.description || 'Описание не указано.'}</p>
            </div>
            <button
              type="button"
              className="hero-panel__close"
              onClick={() => setPanelOpen(false)}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}
    </span>
  )
}
