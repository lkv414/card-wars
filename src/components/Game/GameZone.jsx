/**
 * GameZone - Single zone on the game board (like UNO field)
 */
import './GameZone.css'
import Card3D from './Card3D'

export function GameZone({ zoneIndex, cards, isOpponentZone, onCardClick, onAttack }) {
  const handleCardClick = (card, index) => {
    if (!isOpponentZone && onCardClick) {
      onCardClick(card, index)
    }
  }

  const handleAttackClick = (card) => {
    if (!isOpponentZone && onAttack) {
      onAttack(zoneIndex, card.id, zoneIndex)
    }
  }

  return (
    <div className={`game-zone ${isOpponentZone ? 'opponent' : 'player'}`}>
      <div className="zone-background">
        <div className="zone-grid">
          {cards && cards.length > 0 ? (
            cards.map((card, idx) => (
              <div
                key={card.id || idx}
                className={`card-slot ${card.tapped ? 'tapped' : ''}`}
                onClick={() => handleCardClick(card, idx)}
              >
                <Card3D
                  card={card}
                  isOpponent={isOpponentZone}
                  onAttack={() => handleAttackClick(card)}
                />
              </div>
            ))
          ) : (
            <div className="empty-zone">
              <span className="zone-label">Зона {zoneIndex + 1}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default GameZone
