import { Modal } from '../../Shared/Modal'
import { CardDisplay } from '../../Shared/CardDisplay'
import '../../Shared/CardDisplay.css'

export function CardPreviewModal({ card, onClose }) {
  if (!card) return null

  return (
    <Modal onClose={onClose} stacked className="modal--compact card-preview-modal">
      <CardDisplay card={card} mode="full" showDescription />
      <button type="button" className="deck-link-btn" onClick={onClose}>
        Закрыть
      </button>
    </Modal>
  )
}
