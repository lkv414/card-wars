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

  const normalizeId = (value) => String(value).trim().toLowerCase()

  const findById = (list, id) => {
    const normalized = normalizeId(id)
    return list.find((item) => normalizeId(item.id) === normalized)
  }

  const deckCards = Object.keys(selectedCards)
    .map((id) => {
      const found = findById(cards, id)
      return { id, found }
    })

  const deckLands = Object.keys(selectedLands)
    .map((id) => {
      const found = findById(lands, id)
      return { id, found }
    })

  const foundDeckCards = deckCards.filter((entry) => entry.found).map((entry) => entry.found)
  const missingDeckCards = deckCards.filter((entry) => !entry.found)
  const foundDeckLands = deckLands.filter((entry) => entry.found).map((entry) => entry.found)
  const missingDeckLands = deckLands.filter((entry) => !entry.found)

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
            {foundDeckCards.length === 0 ? (
              <>
                <p className="empty-message">Пока пусто</p>
                {missingDeckCards.length > 0 && (
                  <div className="missing-list">
                    <strong>Не найдены карты в библиотеке:</strong>
                    <ul>
                      {missingDeckCards.map((entry) => (
                        <li key={entry.id}>{entry.id}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <>
                <CardGrid
                  cards={foundDeckCards}
                  selectedCards={selectedCards}
                  addCard={addCard}
                  removeCard={removeCard}
                  cardTotal={cardTotal}
                />
                {missingDeckCards.length > 0 && (
                  <div className="missing-list">
                    <strong>Не найдены карты в библиотеке:</strong>
                    <ul>
                      {missingDeckCards.map((entry) => (
                        <li key={entry.id}>{entry.id}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="deck-modal-section">
            <h3>🏞 Земли ({landTotal} / 4)</h3>
            {foundDeckLands.length === 0 ? (
              <>
                <p className="empty-message">Пока пусто</p>
                {missingDeckLands.length > 0 && (
                  <div className="missing-list">
                    <strong>Не найдены земли в библиотеке:</strong>
                    <ul>
                      {missingDeckLands.map((entry) => (
                        <li key={entry.id}>{entry.id}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <>
                <CardGrid
                  cards={foundDeckLands}
                  selectedCards={selectedLands}
                  addCard={addLand}
                  removeCard={removeLand}
                  cardTotal={landTotal}
                  isLands={true}
                />
                {missingDeckLands.length > 0 && (
                  <div className="missing-list">
                    <strong>Не найдены земли в библиотеке:</strong>
                    <ul>
                      {missingDeckLands.map((entry) => (
                        <li key={entry.id}>{entry.id}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
