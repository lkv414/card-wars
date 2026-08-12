import { Modal } from '../../Shared/Modal'
import { getCardAttack, getCardCost, getCardHealth, isCreatureCard, isBuildingCard } from '../../../utils/cardFields.ts'
import { hasFlipAbility } from '../../../hooks/game/cardAbilities'

export function CardPreviewModal({ card, onClose }) {
  if (!card) return null

  const cost = getCardCost(card)
  const attack = getCardAttack(card)
  const health = getCardHealth(card)
  const canFlip = hasFlipAbility(card)

  return (
    <Modal onClose={onClose} stacked className="modal--compact card-preview-modal">
      <div className="card-preview-header">
        {card.image_url && (
          <img src={card.image_url} alt="" className="card-preview-img" />
        )}
        <div>
          <h2>{card.name || 'Карта'}</h2>
          <div className="card-preview-stats">
            <span>⚡ {cost}</span>
            {isCreatureCard(card) && attack != null && <span>⚔️ {attack}</span>}
            {(isCreatureCard(card) || isBuildingCard(card)) && health != null && (
              <span>❤️ {health}</span>
            )}
            {card.land_type && card.land_type !== 'any' && (
              <span>🌍 {card.land_type}</span>
            )}
          </div>
        </div>
      </div>

      {card.description && (
        <p className="card-preview-desc">{card.description}</p>
      )}

      {canFlip && card.flip_description && (
        <p className="card-preview-flip">
          <strong>Флюп:</strong> {card.flip_description}
        </p>
      )}

      {!card.description && !card.flip_description && (
        <p className="card-preview-desc card-preview-desc--empty">Описание не указано</p>
      )}

      <button type="button" className="deck-link-btn" onClick={onClose}>
        Закрыть
      </button>
    </Modal>
  )
}
