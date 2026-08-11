import { useMemo, useState } from 'react'
import { supabase } from '../utils/supabase'
import { TopBar } from './TopBar'
import { DeckFilters } from './DeckFilters'
import { DeckModal } from './DeckModal'
import { ConfirmDialog } from './Shared/ConfirmDialog'
import { DeckActions } from './deck/DeckActions'
import { SaveDeckDialog } from './deck/SaveDeckDialog'
import { DeckCardList } from './deck/DeckCardList'
import { LibraryToolbar } from './deck/LibraryToolbar'
import { generateDeckCode, expandDeckCodeWithCardData } from '../utils/deckCode'
import { normalizeDeckEntryId } from '../utils/deckState'
import { useDeckSelection } from '../hooks/useDeckSelection'
import { useDecks } from '../hooks/useDecks'
import { useNavigate } from 'react-router-dom'
import { DEFAULT_FILTERS, filterCards, filterLands } from '../utils/cardSort'

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
  const { addDeck, getSelectedDeck } = useDecks()
  const navigate = useNavigate()
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [saveStep, setSaveStep] = useState('form')
  const [saveName, setSaveName] = useState('')
  const [savedDeck, setSavedDeck] = useState(null)
  const [codeCopied, setCodeCopied] = useState(false)

  const [mode, setMode] = useState('cards')
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [deckModalOpen, setDeckModalOpen] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)

  const deckCode = useMemo(
    () => generateDeckCode(selectedCards, selectedLands),
    [selectedCards, selectedLands]
  )

  const closeSaveDialog = () => {
    setSaveDialogOpen(false)
    setSaveStep('form')
    setSaveName('')
    setSavedDeck(null)
    setCodeCopied(false)
  }

  const handleSaveDeck = () => {
    if (cardTotal === 0 && landTotal === 0) {
      toast?.('error', 'Колода пустая — добавьте хотя бы одну карту')
      return
    }
    if (errors.length > 0) {
      toast?.('error', 'Исправьте ошибки в колоде перед сохранением')
      return
    }
    setSaveName(getSelectedDeck()?.name || '')
    setSaveStep('form')
    setSavedDeck(null)
    setCodeCopied(false)
    setSaveDialogOpen(true)
  }

  const handleConfirmSave = () => {
    const name = saveName.trim() || `Колода ${new Date().toLocaleDateString('ru-RU')}`
    const newDeck = addDeck({ name, selectedCards, selectedLands })
    setSavedDeck({ name: newDeck.name, code: newDeck.code })
    setSaveStep('success')
  }

  const handleCopySavedCode = async () => {
    if (!savedDeck?.code) return
    try {
      await navigator.clipboard.writeText(savedDeck.code)
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 1500)
    } catch {
      window.prompt('Скопируй код колоды:', savedDeck.code)
    }
  }

  const filteredCards = useMemo(() => filterCards(cards, filters), [cards, filters])
  const filteredLands = useMemo(() => filterLands(lands, filters.search), [lands, filters.search])

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

  const handleBlockedAdd = (reason) => {
    if (reason) toast('error', reason)
  }

  return (
    <main className="deck-builder">
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
        onClose={closeSaveDialog}
        onConfirm={handleConfirmSave}
        onCopyCode={handleCopySavedCode}
        onGoToDecks={() => navigate('/decks')}
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
            resultCount={mode === 'cards' ? filteredCards.length : filteredLands.length}
            filters={filters}
            onResetFilters={resetFilters}
          />
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
        </section>
      </div>
    </main>
  )
}
