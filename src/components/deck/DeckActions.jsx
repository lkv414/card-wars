/**
 * DeckActions — док действий внизу экрана.
 */

export function DeckActions({ cardTotal, landTotal, onClear, onSave, onOpenDeck }) {
  const hasCards = cardTotal + landTotal > 0
  if (!hasCards) return null

  return (
    <div className="deck-dock" role="toolbar" aria-label="Действия с колодой">
      <button type="button" className="deck-dock-btn deck-dock-btn--ghost" onClick={onClear}>
        Очистить
      </button>
      <button type="button" className="deck-dock-btn deck-dock-btn--primary" onClick={onOpenDeck}>
        Моя колода
      </button>
      <button type="button" className="deck-dock-btn deck-dock-btn--success" onClick={onSave}>
        Сохранить
      </button>
    </div>
  )
}
