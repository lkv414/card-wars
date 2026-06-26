import { useEffect } from 'react'
import { ImageThumb } from './Shared/ImageThumb'
import { CardGrid } from './CardGrid'

export function DeckModal({
  open,
  onClose,
  selectedCards,
  selectedLands,
  cards,
  lands,
  removeCard,
  removeLand,
}) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    if (open) {
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  const cardTotal = Object.values(selectedCards).reduce((a, b) => a + b, 0)
  const landTotal = Object.values(selectedLands).reduce((a, b) => a + b, 0)

  // Получить карты и земли которые в колоде
  const selectedCardsList = Object.keys(selectedCards)
    .map((id) => cards.find((c) => c.id === id))
    .filter(Boolean)

  const selectedLandsList = Object.keys(selectedLands)
    .map((id) => lands.find((l) => l.id === id))
    .filter(Boolean)

  return (
    <div className="deck-modal-overlay" onClick={onClose}>
      <div className="deck-modal" onClick={(e) => e.stopPropagation()}>
        <div className="deck-modal-header">
          <h2>🎒 Твоя колода</h2>
          <button className="deck-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="deck-modal-content">
          {/* Карты секция */}
          <section className="deck-modal-section">
            <h3>🃏 Карты ({cardTotal} / 40)</h3>
            {selectedCardsList.length === 0 ? (
              <p className="empty-message">Пока пусто</p>
            ) : (
              <div className="cards-grid">
                {selectedCardsList.map((card) => (
                  <div key={card.id} className="card-item-in-modal">
                    <ImageThumb src={card.image_url} size="medium" alt={card.name} />
                    <div className="card-item-info">
                      <h4>{card.name}</h4>
                      <small>#{card.card_number}</small>
                    </div>
                    <div className="card-modal-controls">
                      <span className="card-qty">×{selectedCards[card.id]}</span>
                      <button
                        className="card-remove-btn"
                        onClick={() => removeCard(card.id)}
                      >
                        −
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Земли секция */}
          <section className="deck-modal-section">
            <h3>🏞 Земли ({landTotal} / 4)</h3>
            {selectedLandsList.length === 0 ? (
              <p className="empty-message">Пока пусто</p>
            ) : (
              <div className="cards-grid">
                {selectedLandsList.map((land) => (
                  <div key={land.id} className="card-item-in-modal">
                    <ImageThumb src={land.image_url} size="medium" alt={land.name} />
                    <div className="card-item-info">
                      <h4>{land.name}</h4>
                    </div>
                    <div className="card-modal-controls">
                      <span className="card-qty">×{selectedLands[land.id]}</span>
                      <button
                        className="card-remove-btn"
                        onClick={() => removeLand(land.id)}
                      >
                        −
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
