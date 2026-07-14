import { useMemo, useState } from 'react'
import { supabase } from '../utils/supabase'
import { TopBar } from './TopBar'
import { DeckFilters } from './DeckFilters'
import { CardGrid } from './CardGrid'
import { DeckModal } from './DeckModal'
import { ConfirmDialog } from './Shared/ConfirmDialog'
import { CardPreview } from './Shared/CardPreview'
import { CardSkeletonGrid } from './Shared/CardSkeleton'
import { generateDeckCode, expandDeckCodeWithCardData } from '../utils/deckCode'
import { normalizeDeckEntryId } from '../utils/deckState'
import { useDeckSelection } from '../hooks/useDeckSelection'
import {
  DEFAULT_FILTERS,
  hasActiveFilters,
  matchesCostFilter,
  sortCards,
} from '../utils/cardSort'

export function DeckBuilder({
  cards,
  lands,
  loadingLibrary,
  libraryError,
  toast,
}) {
  const {
    selectedCards,
    selectedLands,
    setSelectedCards,
    setSelectedLands,
    addCard,
    removeCard,
    addLand,
    removeLand,
    clearDeck,
    cardTotal,
    landTotal,
    errors,
    warnings,
  } = useDeckSelection()

  const [mode, setMode] = useState('cards')
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [deckModalOpen, setDeckModalOpen] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [preview, setPreview] = useState({ open: false, card: null, isLand: false })

  const deckCode = useMemo(
    () => generateDeckCode(selectedCards, selectedLands),
    [selectedCards, selectedLands]
  )

  const filteredCards = useMemo(() => {
    const next = cards.filter(
      (card) =>
        (!filters.search ||
          `${card.name} ${card.description}`
            .toLowerCase()
            .includes(filters.search.toLowerCase())) &&
        (!filters.cardTypes.length || filters.cardTypes.includes(card.card_type)) &&
        (!filters.landTypes.length || filters.landTypes.includes(card.land_type)) &&
        (!filters.rainbow || card.is_rainbow) &&
        matchesCostFilter(card.cost, filters.costs) &&
        (!filters.flipOnly || card.has_flip)
    )
    return sortCards(next, filters.sort || 'number')
  }, [cards, filters])

  const filteredLands = useMemo(() => {
    if (!filters.search) return lands
    const q = filters.search.toLowerCase()
    return lands.filter((land) => String(land.name || '').toLowerCase().includes(q))
  }, [lands, filters.search])

  const importDeck = async (code) => {
    const trimmedCode = code.trim()
    if (!trimmedCode) {
      toast('error', 'Введите код колоды')
      return
    }

    try {
      toast('success', 'Расширяем код колоды из БД...')
      const { selectedCards: importedCards, selectedLands: importedLands } =
        await expandDeckCodeWithCardData(trimmedCode, supabase)

      const normalizeToLowerMap = (obj) =>
        Object.fromEntries(
          Object.entries(obj || {})
            .map(([id, qty]) => [normalizeDeckEntryId(id), Number(qty) || 0])
            .filter(([, q]) => q > 0)
        )

      setSelectedCards(normalizeToLowerMap(importedCards))
      setSelectedLands(normalizeToLowerMap(importedLands))
      toast(
        'success',
        `Колода импортирована: ${Object.keys(importedCards || {}).length} карт, ${
          Object.keys(importedLands || {}).length
        } земель`
      )
    } catch (error) {
      toast('error', `Ошибка импорта: ${error.message}`)
    }
  }

  const copyDeckCode = async (code) => {
    if (!code) {
      toast('error', 'Код колоды пуст')
      return
    }
    try {
      await navigator.clipboard.writeText(code)
      toast('success', 'Код скопирован')
    } catch {
      toast('error', 'Не удалось скопировать код')
    }
  }

  const resetFilters = () => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort })

  const openPreview = (card, isLand = false) => {
    setPreview({ open: true, card, isLand })
  }

  const handleBlockedAdd = (reason) => {
    if (reason) toast('error', reason)
  }

  return (
    <main className="app">
      <TopBar
        deckCode={deckCode}
        cardTotal={cardTotal}
        landTotal={landTotal}
        errors={errors}
        warnings={warnings}
        importDeck={importDeck}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((open) => !open)}
        onCopyCode={copyDeckCode}
      />

      {(cardTotal + landTotal) > 0 && (
        <>
          <button
            type="button"
            className="panel-button bottom-left trash-btn"
            title="Очистить колоду"
            aria-label="Очистить колоду"
            onClick={() => setClearConfirmOpen(true)}
          >
            🗑️
          </button>

          <button
            type="button"
            className="panel-button bottom-right"
            onClick={() => setDeckModalOpen(true)}
          >
            Твоя колода
          </button>
        </>
      )}

      <ConfirmDialog
        open={clearConfirmOpen}
        title="Очистить колоду?"
        message="Все выбранные карты и земли будут удалены. Это действие нельзя отменить."
        confirmLabel="Очистить"
        cancelLabel="Отмена"
        danger
        onCancel={() => setClearConfirmOpen(false)}
        onConfirm={() => {
          clearDeck()
          setClearConfirmOpen(false)
          toast('success', 'Колода очищена')
        }}
      />

      <CardPreview
        open={preview.open}
        card={preview.card}
        isLand={preview.isLand}
        onClose={() => setPreview({ open: false, card: null, isLand: false })}
      />

      <DeckModal
        open={deckModalOpen}
        onClose={() => setDeckModalOpen(false)}
        selectedCards={selectedCards}
        selectedLands={selectedLands}
        cards={cards}
        lands={lands}
        addCard={addCard}
        removeCard={removeCard}
        addLand={addLand}
        removeLand={removeLand}
        onPreview={openPreview}
        onBlockedAdd={handleBlockedAdd}
      />

      <div className="layout">
        <DeckFilters
          filters={filters}
          setFilters={setFilters}
          mode={mode}
          setMode={setMode}
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          onReset={resetFilters}
        />

        <section className="list">
          {loadingLibrary && (
            <>
              <div className="list-status">Загружаем карты и земли...</div>
              <CardSkeletonGrid count={12} />
            </>
          )}

          {libraryError && (
            <div className="empty-state empty-state-error">Ошибка Supabase: {libraryError}</div>
          )}

          {!loadingLibrary && !libraryError && mode === 'cards' && filteredCards.length === 0 && (
            <div className="empty-state">
              <p>Нет карт для выбранных фильтров.</p>
              {hasActiveFilters(filters) && (
                <button type="button" className="empty-cta" onClick={resetFilters}>
                  Сбросить фильтры
                </button>
              )}
            </div>
          )}

          {!loadingLibrary && !libraryError && mode === 'lands' && filteredLands.length === 0 && (
            <div className="empty-state">
              <p>В таблице lands пока нет земель{filters.search ? ' по этому поиску' : ''}.</p>
              {filters.search && (
                <button
                  type="button"
                  className="empty-cta"
                  onClick={() => setFilters((p) => ({ ...p, search: '' }))}
                >
                  Очистить поиск
                </button>
              )}
            </div>
          )}

          {!loadingLibrary && !libraryError && mode === 'cards' && filteredCards.length > 0 && (
            <CardGrid
              cards={filteredCards}
              selectedCards={selectedCards}
              addCard={addCard}
              removeCard={removeCard}
              cardTotal={cardTotal}
              onPreview={openPreview}
              onBlockedAdd={handleBlockedAdd}
            />
          )}

          {!loadingLibrary && !libraryError && mode === 'lands' && filteredLands.length > 0 && (
            <CardGrid
              cards={filteredLands}
              selectedCards={selectedLands}
              addCard={addLand}
              removeCard={removeLand}
              cardTotal={landTotal}
              isLands
              onPreview={openPreview}
              onBlockedAdd={handleBlockedAdd}
            />
          )}
        </section>
      </div>
    </main>
  )
}
