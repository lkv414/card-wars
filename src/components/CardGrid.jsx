import { CardTile } from './Shared/CardTile'

export function CardGrid({
  cards,
  selectedCards,
  addCard,
  removeCard,
  cardTotal,
  isLands = false,
  onPreview,
  onBlockedAdd,
  compact = false,
}) {
  return (
    <div className="cards-grid" role="list">
      {cards.map((item) => (
        <div key={item.id} role="listitem">
          <CardTile
            item={item}
            isLand={isLands}
            selectedCards={selectedCards}
            addCard={addCard}
            removeCard={removeCard}
            cardTotal={cardTotal}
            onPreview={onPreview}
            onBlockedAdd={onBlockedAdd}
            compact={compact}
          />
        </div>
      ))}
    </div>
  )
}
