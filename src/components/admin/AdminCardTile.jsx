import { memo, useState } from 'react'
import { CARD_TYPES, LAND_TYPES } from '../../constants/game'
import { getIssueSeverity } from '../../utils/adminCardValidation'

const TYPE_CLASS = {
  creature: 'badge-creature',
  building: 'badge-building',
  spell: 'badge-spell',
}

export const AdminCardTile = memo(function AdminCardTile({ card, issues = [], onClick }) {
  const [imageFailed, setImageFailed] = useState(false)
  const hasImage = card.image_url && !imageFailed
  const severity = getIssueSeverity(issues)
  const land = LAND_TYPES[card.land_type] || LAND_TYPES.any

  return (
    <article
      className={[
        'admin-card-tile',
        severity ? `admin-card-tile--${severity}` : '',
        onClick ? 'admin-card-tile--clickable' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => onClick?.(card)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.(card)
        }
      }}
      tabIndex={onClick ? 0 : -1}
      role="button"
      aria-label={`${card.name || 'Без названия'}, №${card.card_number ?? '?'}. ${issues.length ? `${issues.length} замечаний` : 'OK'}`}
    >
      <div className="admin-card-tile-visual">
        {hasImage ? (
          <img
            src={card.image_url}
            alt=""
            className="admin-card-tile-img"
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="admin-card-tile-fallback" aria-hidden="true">
            <span>{land.icon}</span>
          </div>
        )}
        <span className="admin-card-tile-num">#{card.card_number ?? '?'}</span>
        {severity && (
          <span className={`admin-card-tile-severity admin-card-tile-severity--${severity}`}>
            {severity === 'error' ? '!' : '⚠'}
          </span>
        )}
      </div>

      <div className="admin-card-tile-body">
        <div className="admin-card-tile-head">
          <h3 className="admin-card-tile-name">{card.name || '— без названия —'}</h3>
          <span className={`badge ${TYPE_CLASS[card.card_type] || ''}`}>
            {CARD_TYPES[card.card_type] || card.card_type || '?'}
          </span>
        </div>

        <dl className="admin-card-tile-attrs">
          <div>
            <dt>💧</dt>
            <dd>{card.cost ?? '—'}</dd>
          </div>
          {card.card_type === 'creature' && (
            <>
              <div>
                <dt>⚔️</dt>
                <dd>{card.attack ?? '—'}</dd>
              </div>
              <div>
                <dt>❤️</dt>
                <dd>{card.health ?? '—'}</dd>
              </div>
            </>
          )}
          <div className="admin-card-tile-attr-land" title={land.label}>
            <dt>{land.icon}</dt>
            <dd>{land.shortLabel}</dd>
          </div>
        </dl>

        <div className="admin-card-tile-flags">
          {card.has_flip && <span className="admin-flag admin-flag--flip">Флюп</span>}
          {card.is_rainbow && <span className="admin-flag admin-flag--rainbow">🌈</span>}
          {!card.image_url && <span className="admin-flag admin-flag--muted">нет art</span>}
        </div>

        {issues.length > 0 && (
          <ul className="admin-card-tile-issues">
            {issues.slice(0, 3).map((issue) => (
              <li
                key={issue.code}
                className={`admin-issue admin-issue--${issue.severity}`}
                title={issue.label}
              >
                {issue.label}
              </li>
            ))}
            {issues.length > 3 && (
              <li className="admin-issue admin-issue--more">+{issues.length - 3}</li>
            )}
          </ul>
        )}
      </div>
    </article>
  )
})
