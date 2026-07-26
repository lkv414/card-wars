/**
 * PlayerHand - Display player's hand and allow card selection
 */
import './PlayerHand.css'
import Card3D from './Card3D'

export function PlayerHand({
  cards,
  actionsRemaining,
  isYourTurn,
  onPlayCard,
  selectedCardIndex,
  onSelectCard,
}) {
  const handleCardSelect = (index) => {
    if (isYourTurn && actionsRemaining > 0) {
      onSelectCard(selectedCardIndex === index ? null : index)
    }
  }

  const handlePlayInZone = zoneIndex => {
    if (selectedCardIndex !== null) {
      onPlayCard(selectedCardIndex, zoneIndex)
    }
  }

  return (
    <div className="player-hand">
      <div className="hand-header">
        <h3>Ваша рука</h3>
        <span className="card-count">{cards.length} карт</span>
      </div>

      <div className="hand-cards">
        {cards.length > 0 ? (
          cards.map((card, idx) => (
            <div
              key={idx}
              className={`hand-card-wrapper ${selectedCardIndex === idx ? 'selected' : ''} ${!isYourTurn ? 'disabled' : ''}`}
              style={{ '--i': idx, '--n': cards.length }}
              onClick={() => handleCardSelect(idx)}
            >
              <Card3D card={card} isOpponent={false} />
              <div className="card-info">
                <span className="cost-badge">{card.cost} ✨</span>
              </div>
            </div>
          ))
        ) : (
          <div className="empty-hand">Нет карт на руке</div>
        )}
      </div>

      {selectedCardIndex !== null && isYourTurn && (
        <div className="zone-selector">
          <p>Выберите зону для разыгрывания:</p>
          <div className="zone-buttons">
            {[0, 1, 2, 3].map(zoneIdx => (
              <button
                key={zoneIdx}
                className="zone-btn"
                onClick={() => handlePlayInZone(zoneIdx)}
              >
                Зона {zoneIdx + 1}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default PlayerHand
