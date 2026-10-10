/**
 * CardFace — ЕДИНЫЙ рендер карты для всего DOM-интерфейса.
 *
 * Аудит §2.1-2.4: колода (CardTile), админка (AdminCardTile), рука (HUDHand),
 * превью (CardPreviewModal) и форма правки (CardForm) рисовали карту каждый
 * по-своему. Здесь — один компонент, который берёт значения ТОЛЬКО из
 * resolveCardFace() (src/utils/cardFaceModel.js) и рисует их одинаково везде.
 *
 * 3D-стол этот компонент не рендерит: он отдаёт CanvasTexture как кэш
 * (utils/cardCompositeTexture.js), но значения берёт из тех же полей лица.
 *
 * Режимы:
 *   'hand' — компактная карта в руке (арт + стоимость), для drag.
 *   'tile' — плитка в библиотеке и админке.
 *   'full' — превью с описанием, землёй, флипом, героем.
 *
 * Специальных пропсов-обходов нет: карта всегда проходит через resolveCardFace.
 */
import { memo } from 'react'

import { resolveCardFace, STAT_ICONS } from '../../utils/cardFaceModel.js'
import './CardFace.css'

const TYPE_CLASS = {
  creature: 'card-face-type--creature',
  building: 'card-face-type--building',
  spell: 'card-face-type--spell',
}

export const CardFace = memo(function CardFace({
  card,
  mode = 'tile',
  onClick,
  selected = false,
  showDescription = false,
  /** Порядковый номер — показывается в админке и плитках. */
  cardNumber = null,
  /** Показывать иконку типа карты (плитка). */
  showTypeBadge = true,
  className = '',
  style,
  children,
}) {
  const face = resolveCardFace(card)
  if (!face) return null

  const { showStats } = face
  // Атака/здоровье показываем боевые (с баффами), если они есть.
  const attack = face.buffed ? face.effectiveAttack : face.attack
  const health = face.buffed ? face.effectiveHealth : face.health

  const rootClass = [
    'card-face',
    `card-face--${mode}`,
    selected ? 'card-face--selected' : '',
    onClick ? 'card-face--clickable' : '',
    face.isFlipped ? 'card-face--flipped' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  // Рамка по земле — из справочника (Ф3), а не хардкод в потребителе.
  const rootStyle = {
    ...style,
    '--card-face-land-border': face.landCssBorder,
  }

  const art = face.imageUrl ? (
    <img
      src={face.imageUrl}
      alt=""
      className="card-face-img"
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  ) : (
    <div className="card-face-fallback" aria-hidden="true">
      <span className="card-face-fallback-icon">{face.landIcon}</span>
    </div>
  )

  // Блок статов — общий для 'tile' и 'full', чтобы поля и подписи совпадали.
  const statsBlock = (
    <div className="card-face-stats">
      <span className="card-face-stat card-face-stat--cost" title="Стоимость">
        {STAT_ICONS.cost} {face.cost}
      </span>
      {showStats && (
        <>
          <span
            className={`card-face-stat ${face.buffed ? 'card-face-stat--buffed' : ''}`}
            title="Атака"
          >
            {STAT_ICONS.attack} {attack ?? '—'}
          </span>
          <span
            className={`card-face-stat ${face.buffed ? 'card-face-stat--buffed' : ''}`}
            title="Здоровье"
          >
            {STAT_ICONS.health} {health ?? '—'}
          </span>
        </>
      )}
    </div>
  )

  // Предупреждение о данных видно и в плитке (её рисует админка).
  const landWarn = face.landUnknown ? (
    <p className="card-face-warn" role="note">
      Тип земли «{card?.land_type}» не найден в справочнике — карта считается
      универсальной. Поправьте <code>land_type</code> в каталоге.
    </p>
  ) : null

  const clickProps = onClick
    ? { onClick, role: 'button', tabIndex: 0, onKeyDown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() }
      } }
    : {}

  // ── Режим 'hand': арт + стоимость ─────────────────────────────────────────
  if (mode === 'hand') {
    return (
      <div className={rootClass} style={rootStyle} {...clickProps}>
        <div className="card-face-art">{art}</div>
        <span className="card-face-cost" aria-hidden="true">
          {face.cost}
        </span>
        <span className="sr-only">
          {face.name}, стоимость {face.cost}
        </span>
        {face.isFlipped && <span className="card-face-flipmark" aria-hidden="true">🔄</span>}
      </div>
    )
  }

  // ── Режим 'full': превью ──────────────────────────────────────────────────
  if (mode === 'full') {
    return (
      <div className={rootClass} style={rootStyle} {...clickProps}>
        <div className="card-face-art card-face-art--large">{art}</div>
        <div className="card-face-body">
          <h3 className="card-face-name">{face.name || '— без названия —'}</h3>

          {statsBlock}

          <div className="card-face-meta">
            {face.type && (
              <span className={`card-face-type ${TYPE_CLASS[face.type] || ''}`}>
                {face.typeLabel}
              </span>
            )}
            <span className="card-face-land" title={face.landLabel}>
              {face.landIcon} {face.landLabel}
            </span>
            {face.isRainbow && <span className="card-face-rainbow">🌈</span>}
            {face.cardNumber !== null && (
              <span className="card-face-number">#{face.cardNumber}</span>
            )}
          </div>

          {/* Неотображённый тип земли — данные требуют правки (Ф3.4). */}
          {landWarn}

          {showDescription && face.description && (
            <p className="card-face-desc">{face.description}</p>
          )}
          {face.hasFlip && face.flipDescription && (
            <p className="card-face-flip">
              <strong>Флюп:</strong> {face.flipDescription}
            </p>
          )}
          {face.hero && (
            <p className="card-face-hero">
              <strong>Герой:</strong> {face.hero}
            </p>
          )}
          {(face.rarity || face.source) && (
            <p className="card-face-tags">
              {face.rarity && <span>Редкость: {face.rarity}</span>}
              {face.source && <span>Источник: {face.source}</span>}
            </p>
          )}
        </div>
      </div>
    )
  }

  // ── Режим 'tile': плитка ─────────────────────────────────────────────────
  return (
    <div className={rootClass} style={rootStyle} {...clickProps}>
      <div className="card-face-art">
        {art}
        {showTypeBadge && face.type && (
          <span className={`card-face-type-badge ${TYPE_CLASS[face.type] || ''}`}>
            {face.typeLabel}
          </span>
        )}
        {face.isFlipped && <span className="card-face-flipmark" aria-hidden="true">🔄</span>}
      </div>

      <div className="card-face-body card-face-body--tile">
        <h4 className="card-face-name">{face.name || '— без названия —'}</h4>
        {statsBlock}
        {showDescription && face.description && (
          <p className="card-face-desc">{face.description}</p>
        )}
        {landWarn}
      </div>

      {children}
    </div>
  )
})

export default CardFace