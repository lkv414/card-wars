import { useMemo, useState } from 'react'
import { TopBar } from './TopBar'
import { DeckFilters } from './DeckFilters'
import { DeckModal } from './DeckModal'
import { ConfirmDialog } from './Shared/ConfirmDialog'
import { DeckActions } from './deck/DeckActions'
import { SaveDeckDialog } from './deck/SaveDeckDialog'
import { DeckCardList } from './deck/DeckCardList'
import { LibraryToolbar } from './deck/LibraryToolbar'
import { HeroPicker } from './DeckBuilder/HeroPicker'
import { generateDeckCode, expandDeckCodeWithCardData } from '../utils/deckCode'
import { normalizeDeckImportMap } from '../utils/deckImport'
import { copyToClipboard } from '../utils/clipboard'
import { useDeckSelection } from '../hooks/useDeckSelection'
import { useDecks } from '../hooks/useDecks'
import { useDeckSave } from '../hooks/useDeckSave'
import { useHeroes } from '../hooks/useHeroes'
import { useBackNavigation } from '../hooks/useBackNavigation'
import { DEFAULT_FILTERS, filterCards, filterLands } from '../utils/cardSort'
import { isDeckCard } from '../utils/deckCards'

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
    heroId: selectionHeroId,
    setHeroId,
    editingDeckId,
    clearEditingDeck,
  } = useDeckSelection()
  const { addDeck, updateDeckContents, getDeckById } = useDecks()
  const { heroes, loading: heroesLoading } = useHeroes()
  const goBack = useBackNavigation('/decks')

  const editingDeck = useMemo(
    () => (editingDeckId ? getDeckById(editingDeckId) : null),
    [editingDeckId, getDeckById]
  )

  const {
    saveDialogOpen,
    saveStep,
    saveName,
    setSaveName,
    savedDeck,
    codeCopied,
    updateExisting,
    setUpdateExisting,
    closeSaveDialog,
    handleSaveDeck,
    handleConfirmSave,
    handleCopySavedCode,
  } = useDeckSave({
    cardTotal,
    landTotal,
    errors,
    selectedCards,
    selectedLands,
    heroId: selectionHeroId,
    editingDeck,
    addDeck,
    updateDeckContents,
    clearEditingDeck,
    toast,
  })

  const [mode, setMode] = useState('cards')
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [deckModalOpen, setDeckModalOpen] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)

  // По клику на «Герой» в TopBar переключаем на вкладку heroes.
  const handleOpenHeroes = () => {
    setFiltersOpen(false)
    setMode('heroes')
  }

  const selectedHero = useMemo(() => {
    if (!selectionHeroId || !heroes?.length) return null
    return heroes.find((h) => h.id === selectionHeroId) || null
  }, [selectionHeroId, heroes])

  const deckCode = useMemo(
    () => generateDeckCode(selectedCards, selectedLands),
    [selectedCards, selectedLands]
  )

  const filteredCards = useMemo(() => filterCards(cards.filter(isDeckCard), filters), [cards, filters])
  const filteredLands = useMemo(() => filterLands(lands, filters.search), [lands, filters.search])

  const importDeck = async (code) => {
    const trimmedCode = code.trim()
    if (!trimmedCode) {
      toast('error', 'Введите код колоды')
      return
    }

    try {
      toast('success', 'Импортируем колоду...')
      const { selectedCards: importedCards, selectedLands: importedLands } =
        expandDeckCodeWithCardData(trimmedCode)

      setSelectedCards(normalizeDeckImportMap(importedCards))
      setSelectedLands(normalizeDeckImportMap(importedLands))
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
    const ok = await copyToClipboard(code)
    toast(ok ? 'success' : 'error', ok ? 'Код скопирован' : 'Не удалось скопировать код')
  }

  const resetFilters = () => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort })

  const handleBlockedAdd = (reason) => {
    if (reason) toast('error', reason)
  }

  return (
    <main className="deck-builder">
      <TopBar
        onBack={goBack}
        deckCode={deckCode}
        cardTotal={cardTotal}
        landTotal={landTotal}
        heroLabel={selectedHero?.name}
        heroMissing={!selectionHeroId}
        heroProgress={Math.min(1, (cardTotal + landTotal) / 44)}
        onOpenHeroes={handleOpenHeroes}
        errors={errors}
        warnings={warnings}
        importDeck={importDeck}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((open) => !open)}
        onCopyCode={copyDeckCode}
      />

      <DeckActions
        cardTotal={cardTotal}
        landTotal={landTotal}
        onClear={() => setClearConfirmOpen(true)}
        onSave={handleSaveDeck}
        onOpenDeck={() => setDeckModalOpen(true)}
      />

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

      <SaveDeckDialog
        open={saveDialogOpen}
        step={saveStep}
        saveName={saveName}
        setSaveName={setSaveName}
        cardTotal={cardTotal}
        landTotal={landTotal}
        savedDeck={savedDeck}
        codeCopied={codeCopied}
        editingDeckName={editingDeck?.name ?? null}
        updateExisting={updateExisting}
        onUpdateExistingChange={setUpdateExisting}
        onClose={closeSaveDialog}
        onConfirm={handleConfirmSave}
        onCopyCode={handleCopySavedCode}
        onGoToDecks={goBack}
      />

      <DeckModal
        open={deckModalOpen}
        onClose={() => setDeckModalOpen(false)}
        selectedCards={selectedCards}
        selectedLands={selectedLands}
        cards={cards}
        lands={lands}
        hero={selectedHero}
        onOpenHeroes={() => {
          setDeckModalOpen(false)
          handleOpenHeroes()
        }}
        addCard={addCard}
        removeCard={removeCard}
        addLand={addLand}
        removeLand={removeLand}
        onBlockedAdd={handleBlockedAdd}
      />

      <div className="layout">
        <DeckFilters
          filters={filters}
          setFilters={setFilters}
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          onReset={resetFilters}
          mode={mode}
        />

        <section className="deck-library">
          <LibraryToolbar
            mode={mode}
            setMode={setMode}
            resultCount={
              mode === 'cards'
                ? filteredCards.length
                : mode === 'lands'
                  ? filteredLands.length
                  : heroes.length
            }
            filters={filters}
            onResetFilters={resetFilters}
          />
          {mode === 'heroes' ? (
            <HeroPicker
              heroes={heroes}
              selectedHeroId={selectionHeroId}
              onChange={setHeroId}
              loading={heroesLoading}
            />
          ) : (
            <DeckCardList
              loadingLibrary={loadingLibrary}
              libraryError={libraryError}
              mode={mode}
              filteredCards={filteredCards}
              filteredLands={filteredLands}
              selectedCards={selectedCards}
              selectedLands={selectedLands}
              cardTotal={cardTotal}
              landTotal={landTotal}
              filters={filters}
              onBlockedAdd={handleBlockedAdd}
              onAddCard={addCard}
              onRemoveCard={removeCard}
              onAddLand={addLand}
              onRemoveLand={removeLand}
              onResetFilters={resetFilters}
              onClearSearch={() => setFilters((p) => ({ ...p, search: '' }))}
            />
          )}
        </section>
      </div>
    </main>
  )
}
