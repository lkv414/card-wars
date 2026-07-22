/**
 * Card3D - 3D Card component with flip animation
 * Uses CSS 3D transforms for UNO-like effects
 */
import { useState } from 'react'
import './Card3D.css'

export function Card3D({ card, isOpponent, onAttack }) {
  const [isFlipped, setIsFlipped] = useState(card?.flipped || false)
  const [isHovered, setIsHovered] = useState(false)

  const handleFlip = e => {
    e.stopPropagation()
    setIsFlipped(!isFlipped)
  }

  if (!card) {
    return <div className="card-3d empty" />
  }

  return (
    <div
      className={`card-3d ${card.tapped ? 'tapped' : ''} ${isOpponent ? 'opponent' : 'player'}`}
      style={{
        transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Front side */}
      <div className="card-front">
        <div className="card-header">
          <h3 className="card-name">{card.name}</h3>
          <span className="card-cost">{card.cost}</span>
        </div>

        <div className="card-image">
          {card.image_url ? (
            <img src={card.image_url} alt={card.name} />
          ) : (
            <div className="card-placeholder">{card.card_type}</div>
          )}
        </div>

        <div className="card-stats">
          {card.attack !== undefined && (
            <div className="stat attack">
              <span className="label">ATK</span>
              <span className="value">{card.attack}</span>
            </div>
          )}
          {card.health !== undefined && (
            <div className="stat health">
              <span className="label">HP</span>
              <span className="value">{card.health}</span>
            </div>
          )}
        </div>

        <div className="card-description">
          <p>{card.description || 'Нет описания'}</p>
        </div>

        {card.has_flip && (
          <button className="flip-btn" onClick={handleFlip} title="Flip card">
            🔄
          </button>
        )}
      </div>

      {/* Back side (flipped state) */}
      {card.has_flip && (
        <div className="card-back" onClick={handleFlip}>
          <div className="card-flip-content">
            <h4>Flipped</h4>
            <p>{card.flip_description || 'Card flipped'}</p>
          </div>
        </div>
      )}

      {/* Tapped indicator */}
      {card.tapped && <div className="tapped-indicator">✓ Используется</div>}

      {/* Attack button (opponent zones) */}
      {!isOpponent && isHovered && onAttack && (
        <button className="attack-btn" onClick={onAttack}>
          ⚔️ Атака
        </button>
      )}
    </div>
  )
}

export default Card3D
