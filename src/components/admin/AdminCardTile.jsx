import { memo } from 'react'
import { CardFace } from '../Shared/CardFace'
import { getIssueSeverity } from '../../utils/adminCardValidation'

/**
 * AdminCardTile — карта в админке.
 * Использует CardDisplay для единообразного отображения.
 */
export const AdminCardTile = memo(function AdminCardTile({ card, issues = [], onClick, selected = false }) {
  const severity = getIssueSeverity(issues)

  return (
    <div
      className={[
        'admin-card-tile',
        severity ? `admin-card-tile--${severity}` : '',
        onClick ? 'admin-card-tile--clickable' : '',
        selected ? 'admin-card-tile--selected' : '',
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
      {/* Тип земли, не найденный в справочнике, помечается самим CardFace. */}
      <CardFace card={card} mode="tile" showDescription cardNumber={null} />
      <div className="admin-card-tile-num">#{card.card_number ?? '?'}</div>
      {severity && (
        <span className={`admin-card-tile-severity admin-card-tile-severity--${severity}`}>
          {severity === 'error' ? '!' : '⚠'}
        </span>
      )}
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
  )
})
