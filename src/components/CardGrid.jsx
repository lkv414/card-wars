import { CardTile } from './Shared/CardTile'

export function CardGrid({
  cards,
  selectedCards,
  addCard,
  removeCard,
  cardTotal,
  isLands = false,
}) {
  return (
    <div className="cards-grid">
      {cards.map((item) => (
        <CardTile
          key={item.id}
          item={item}
          isLand={isLands}
          selectedCards={selectedCards}
          addCard={addCard}
          removeCard={removeCard}
          cardTotal={cardTotal}
        />
      ))}
    </div>
  )
}
