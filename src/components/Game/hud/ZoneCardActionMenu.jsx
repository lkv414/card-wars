import { Modal } from '../../Shared/Modal'

export function ZoneCardActionMenu({ card, onFlip, onDiscard, onClose }) {
  if (!card) return null

  return (
    <Modal onClose={onClose} stacked className="modal--compact">
      <h2>{card.name || 'Карта на поле'}</h2>
      <div className="card-action-menu-actions">
        <button type="button" onClick={() => { onFlip?.(); onClose?.() }}>
          🔄 Флюп
        </button>
        <button type="button" className="delete-btn" onClick={() => { onDiscard?.(); onClose?.() }}>
          🗑️ В сброс
        </button>
        <button type="button" className="deck-link-btn" onClick={onClose}>
          Отмена
        </button>
      </div>
    </Modal>
  )
}
