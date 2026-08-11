/**

 * Card3D - 3D Card component with flip animation

 * Uses CSS 3D transforms for UNO-like effects

 */

import { useState } from 'react'

import './Card3D.css'



export function Card3D({ card, isOpponent, onAttack, compact = false }) {

  const [isFlipped, setIsFlipped] = useState(card?.flipped || false)

  const [isHovered, setIsHovered] = useState(false)



  const handleFlip = e => {

    e.stopPropagation()

    setIsFlipped(!isFlipped)

  }



  if (!card) {

    return <div className="card-3d empty" />

  }



  const hasArt = Boolean(card.image_url)



  return (

    <div

      className={`card-3d ${compact ? 'card-3d--compact' : ''} ${hasArt ? 'card-3d--art' : ''} ${card.tapped ? 'tapped' : ''} ${isOpponent ? 'opponent' : 'player'}`}

      style={{

        transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',

      }}

      onMouseEnter={() => setIsHovered(true)}

      onMouseLeave={() => setIsHovered(false)}

    >

      <div className="card-front">

        {hasArt ? (

          <img src={card.image_url} alt="" className="card-art-full" draggable={false} />

        ) : (

          <div className="card-art-fallback">

            <span className="card-art-fallback-name">{card.name}</span>

            <span className="card-art-fallback-type">{card.card_type}</span>

          </div>

        )}



        {card.has_flip && (

          <button

            type="button"

            className="flip-btn"

            onClick={handleFlip}

            title="Перевернуть карту"

            aria-label="Перевернуть карту"

          >

            🔄

          </button>

        )}

      </div>



      {card.has_flip && (

        <button

          type="button"

          className="card-back"

          onClick={handleFlip}

          aria-label="Перевернуть карту на лицевую сторону"

        >

          <div className="card-flip-content">

            <p>{card.flip_description || 'Card flipped'}</p>

          </div>

        </button>

      )}



      {card.tapped && <div className="tapped-indicator" aria-label="Используется" />}



      {!isOpponent && isHovered && onAttack && (

        <button className="attack-btn" onClick={onAttack}>

          ⚔️ Атака

        </button>

      )}

    </div>

  )

}



export default Card3D


