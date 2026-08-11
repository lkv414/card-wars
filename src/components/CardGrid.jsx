import { memo } from 'react'
import { CardTile } from './Shared/CardTile'

export const CardGrid = memo(function CardGrid({
  cards,
  selectedCards,
  addCard,
  removeCard,
  selectionTotal,
  isLands = false,
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
            selectionTotal={selectionTotal}
            onBlockedAdd={onBlockedAdd}
            compact={compact}
          />
        </div>
      ))}
    </div>
  )
})
