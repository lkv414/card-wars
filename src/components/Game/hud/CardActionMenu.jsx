import { Modal } from '../../Shared/Modal'

export function CardActionMenu({ card, onAttack, onFlip, onClose }) {
  if (!card) return null

  return (
    <Modal onClose={onClose} stacked className="modal--compact">
      <h2>{card.name || 'Карта'}</h2>
      <p className="card-action-menu-sub">Выберите действие</p>
      <div className="card-action-menu-actions">
        <button type="button" className="primary" onClick={() => { onAttack?.(card); onClose?.() }}>
          ⚔️ Атаковать
        </button>
        <button type="button" onClick={() => { onFlip?.(card); onClose?.() }}>
          🔄 Флюп
        </button>
        <button type="button" className="deck-link-btn" onClick={onClose}>
          Отмена
        </button>
      </div>
    </Modal>
  )
}
