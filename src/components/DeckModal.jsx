import { useEffect } from 'react'
import { CardGrid } from './CardGrid'

export function DeckModal({
  open,
  onClose,
  selectedCards,
  selectedLands,
  cards,
  lands,
  addCard,
  removeCard,
  addLand,
  removeLand,
}) {
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose()

    if (!open) return undefined

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const cardTotal = Object.values(selectedCards).reduce((a, b) => a + b, 0)
  const landTotal = Object.values(selectedLands).reduce((a, b) => a + b, 0)

  const deckCards = Object.keys(selectedCards)
    .map((id) => cards.find((card) => String(card.id) === String(id)))
    .filter(Boolean)

  const deckLands = Object.keys(selectedLands)
    .map((id) => lands.find((land) => String(land.id) === String(id)))
    .filter(Boolean)

  return (
    <div className="deck-modal-overlay" onClick={onClose}>
      <div className="deck-modal" onClick={(event) => event.stopPropagation()}>
        <div className="deck-modal-header">
          <h2>🎒 Твоя колода</h2>
          <button className="deck-modal-close" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <div className="deck-modal-content">
          <section className="deck-modal-section">
            <h3>🃏 Карты ({cardTotal} / 40)</h3>
            {deckCards.length === 0 ? (
              <p className="empty-message">Пока пусто</p>
            ) : (
              <CardGrid
                cards={deckCards}
                selectedCards={selectedCards}
                addCard={addCard}
                removeCard={removeCard}
                cardTotal={cardTotal}
              />
            )}
          </section>

          <section className="deck-modal-section">
            <h3>🏞 Земли ({landTotal} / 4)</h3>
            {deckLands.length === 0 ? (
              <p className="empty-message">Пока пусто</p>
            ) : (
              <CardGrid
                cards={deckLands}
                selectedCards={selectedLands}
                addCard={addLand}
                removeCard={removeLand}
                cardTotal={landTotal}
                isLands={true}
              />
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
