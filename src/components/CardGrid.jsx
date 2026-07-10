import { ImageThumb } from './Shared/ImageThumb'
import { normalizeDeckEntryId } from '../utils/deckState'
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
        const normalizedId = normalizeDeckEntryId(item.id)
        const quantity = selectedCards[item.id] || selectedCards[normalizedId] || 0
        if (quantity > 0 && selectedCards[item.id] == null && selectedCards[normalizedId] != null) {
          console.debug('[CardGrid] normalized quantity lookup', {
            itemId: item.id,
            normalizedId,
            quantity,
            selectedCards,
          })
        }
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
