import { ImageThumb } from './Shared/ImageThumb'
import { Badge } from './Shared/Badge'
import { CARD_TYPES, LAND_TYPES } from './DeckFilters'

export function CardGrid({
  cards,
  selectedCards,
  addCard,
  removeCard,
  cardTotal,
  isLands = false,
}) {
  return (
    <div className="cards-grid">
      {cards.map((item) => {
        const quantity = isLands ? selectedCards[item.id] || 0 : selectedCards[item.id] || 0
        const disabled = isLands
          ? false
          : quantity >= 3 || cardTotal >= 40

        const isLand = !!item.name && !item.card_type // Lands don't have card_type

        return (
          <div key={item.id} className="card-item">
            <ImageThumb src={item.image_url} size="medium" alt={item.name} />
            
            <div className="card-item-info">
              <h4>{item.name}</h4>
              {!isLand && <small>#{item.card_number}</small>}
            </div>

            {!isLand && item.description && (
              <div className="card-item-description">{item.description}</div>
            )}

            {!isLand && (
              <div style={{ fontSize: '12px', color: '#8c7660', paddingTop: '6px' }}>
                💧 {item.cost}
                {item.card_type === 'creature' && (
                  <>
                    {' '}
                    · ⚔️ {item.attack} · ❤️ {item.health}
                  </>
                )}
              </div>
            )}

            <div className="card-item-buttons">
              <button
                className="card-add-btn"
                title={disabled ? 'Максимум карт' : 'Добавить'}
                disabled={disabled}
                onClick={() => addCard(item.id)}
              >
                ＋
              </button>
              {quantity > 0 && (
                <>
                  <button
                    className="card-remove-btn"
                    title="Убрать карту"
                    onClick={() => removeCard(item.id)}
                  >
                    −
                  </button>
                  <span className="card-qty">×{quantity}</span>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
