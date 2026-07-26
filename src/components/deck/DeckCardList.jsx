/**
 * DeckCardList — секция с библиотекой карт/земель.
 *
 * - Skeleton при загрузке
 * - Error-баннер при ошибке Supabase
 * - Empty state с CTA «Сбросить фильтры» / «Очистить поиск»
 * - CardGrid (cards или lands) с рендером карточек
 *
 * Props объединяют:
 *   - loadingLibrary, libraryError
 *   - mode: 'cards' | 'lands' (что отображать)
 *   - filteredCards, filteredLands (memoized на уровне DeckBuilder)
 *   - selectedCards, selectedLands
 *   - addCard / removeCard / addLand / removeLand
 *   - cardTotal, landTotal
 *   - onPreview, onBlockedAdd
 *   - filters, resetFilters
 */

import { CardGrid } from '../CardGrid'
import { CardSkeletonGrid } from '../Shared/CardSkeleton'
import { hasActiveFilters } from '../../utils/cardSort'

export function DeckCardList({
  loadingLibrary,
  libraryError,
  mode,
  filteredCards,
  filteredLands,
  selectedCards,
  selectedLands,
  cardTotal,
  landTotal,
  filters,
  onPreview,
  onBlockedAdd,
  onAddCard,
  onRemoveCard,
  onAddLand,
  onRemoveLand,
  onResetFilters,
  onClearSearch,
}) {
  if (loadingLibrary) {
    return (
      <>
        <div className="list-status">Загружаем карты и земли...</div>
        <CardSkeletonGrid count={12} />
      </>
    )
  }

  if (libraryError) {
    return <div className="empty-state empty-state-error">Ошибка Supabase: {libraryError}</div>
  }

  // Empty states
  if (mode === 'cards' && filteredCards.length === 0) {
    return (
      <div className="empty-state">
        <p>Нет карт для выбранных фильтров.</p>
        {hasActiveFilters(filters) && (
          <button type="button" className="empty-cta" onClick={onResetFilters}>
            Сбросить фильтры
          </button>
        )}
      </div>
    )
  }

  if (mode === 'lands' && filteredLands.length === 0) {
    return (
      <div className="empty-state">
        <p>
          В таблице lands пока нет земель
          {filters.search ? ' по этому поиску' : ''}.
        </p>
        {filters.search && (
          <button type="button" className="empty-cta" onClick={onClearSearch}>
            Очистить поиск
          </button>
        )}
      </div>
    )
  }

  // Cards grid
  if (mode === 'cards') {
    return (
      <CardGrid
        cards={filteredCards}
        selectedCards={selectedCards}
        addCard={onAddCard}
        removeCard={onRemoveCard}
        cardTotal={cardTotal}
        onPreview={onPreview}
        onBlockedAdd={onBlockedAdd}
      />
    )
  }

  // Lands grid
  return (
    <CardGrid
      cards={filteredLands}
      selectedCards={selectedLands}
      addCard={onAddLand}
      removeCard={onRemoveLand}
      cardTotal={landTotal}
      isLands
      onPreview={onPreview}
      onBlockedAdd={onBlockedAdd}
    />
  )
}
