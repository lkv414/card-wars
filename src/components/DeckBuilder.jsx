import { useMemo, useState } from 'react'
import { supabase } from '../utils/supabase'
import { TopBar } from './TopBar'
import { DeckFilters } from './DeckFilters'
import { CardGrid } from './CardGrid'
import { DeckModal } from './DeckModal'
import { generateDeckCode, expandDeckCodeWithCardData } from '../utils/deckCode'
import { normalizeDeckEntryId } from '../utils/deckState'
import { useDeckSelection } from '../hooks/useDeckSelection'

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
  const [filters, setFilters] = useState({
    search: '',
    cardTypes: [],
    landTypes: [],
    rainbow: false,
    costMin: 0,
    costMax: 10,
    flipOnly: false,
  })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [deckModalOpen, setDeckModalOpen] = useState(false)

  const deckCode = useMemo(
    () => generateDeckCode(selectedCards, selectedLands),
    [selectedCards, selectedLands]
  )

  const filteredCards = useMemo(
    () =>
      cards.filter(
        (card) =>
          (!filters.search ||
            `${card.name} ${card.description}`.toLowerCase().includes(filters.search.toLowerCase())) &&
          (!filters.cardTypes.length || filters.cardTypes.includes(card.card_type)) &&
          (!filters.landTypes.length || filters.landTypes.includes(card.land_type)) &&
          (!filters.rainbow || card.is_rainbow) &&
          Number(card.cost) >= Number(filters.costMin || 0) &&
          Number(card.cost) <= Number(filters.costMax || 99) &&
          (!filters.flipOnly || card.has_flip)
      ).sort((a, b) => a.card_number - b.card_number),
    [cards, filters]
  )

  const saveDeck = async () => {
    const code = deckCode
    const { error } = await supabase.from('decks').upsert({
      name: code,
      code,
      cards: Object.entries(selectedCards).map(([card_id, quantity]) => ({
        card_id,
        quantity,
      })),
      lands: Object.entries(selectedLands).map(([land_id, quantity]) => ({
        land_id,
        quantity,
      })),
    })

    if (error) {
      toast('error', error.message)
    } else {
      toast('success', `✅ Колода сохранена: ${code}`)
    }
  }

  const importDeck = async (code) => {
    const trimmedCode = code.trim()
    if (!trimmedCode) {
      toast('error', 'Введите код колоды')
      return
    }

    try {
      toast('success', '⏳ Расширяем код колоды из БД...')
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
        `✅ Колода успешно импортирована: ${Object.keys(importedCards || {}).length} карт, ${
          Object.keys(importedLands || {}).length
        } земель`
      )
    } catch (error) {
      toast('error', `❌ Ошибка импорта: ${error.message}`)
    }
  }

  const clearDeckConfirm = () => {
    if (window.confirm('Очистить колоду?')) {
      clearDeck()
    }
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
      />

      {(cardTotal + landTotal) > 0 && (
        <>
          <button
            type="button"
            className="panel-button bottom-left trash-btn"
            title="Очистить колоду"
            aria-label="Очистить колоду"
            onClick={clearDeckConfirm}
          >
            🗑️
          </button>

          <button
            type="button"
            className="panel-button bottom-right"
            onClick={() => setDeckModalOpen(true)}
          >
            🎒 Твоя колода
          </button>
        </>
      )}

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
      />

      <div className="layout">
        <DeckFilters
          filters={filters}
          setFilters={setFilters}
          mode={mode}
          setMode={setMode}
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
        />

        <section className="list">
          {loadingLibrary && <div className="empty-state">⏳ Загружаем карты и земли из Supabase...</div>}
          {libraryError && <div className="empty-state empty-state-error">❌ Ошибка Supabase: {libraryError}</div>}

          {!loadingLibrary && !libraryError && mode === 'cards' && filteredCards.length === 0 && (
            <div className="empty-state">В таблице cards пока нет карт для выбранных фильтров.</div>
          )}

          {!loadingLibrary && !libraryError && mode === 'lands' && lands.length === 0 && (
            <div className="empty-state">В таблице lands пока нет земель.</div>
          )}

          {!loadingLibrary && !libraryError && mode === 'cards' && (
            <CardGrid
              cards={filteredCards}
              selectedCards={selectedCards}
              addCard={addCard}
              removeCard={removeCard}
              cardTotal={cardTotal}
            />
          )}

          {!loadingLibrary && !libraryError && mode === 'lands' && (
            <CardGrid
              cards={lands}
              selectedCards={selectedLands}
              addCard={addLand}
              removeCard={removeLand}
              cardTotal={landTotal}
              isLands={true}
            />
          )}
        </section>
      </div>
    </main>
  )
}
