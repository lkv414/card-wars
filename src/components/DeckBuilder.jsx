import { useState, useMemo } from 'react'
import { supabase } from '../utils/supabase'
import { TopBar } from './TopBar'
import { DeckFilters } from './DeckFilters'
import { CardGrid } from './CardGrid'
import { DeckModal } from './DeckModal'

export function DeckBuilder({
  cards,
  lands,
  loadingLibrary,
  libraryError,
  onAdminClick,
  onBackToMenu,
}) {
  const [selectedCards, setSelectedCards] = useState({})
  const [selectedLands, setSelectedLands] = useState({})
  const [deckName, setDeckName] = useState('')
  const [deckCode, setDeckCode] = useState('')
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
  const [toasts, setToasts] = useState([])
  const [deckModalOpen, setDeckModalOpen] = useState(false)

  const toast = (type, text) => {
    const id = crypto.randomUUID()
    setToasts((p) => [...p, { id, type, text }])
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3000)
  }

  const cardTotal = Object.values(selectedCards).reduce((a, b) => a + b, 0)
  const landTotal = Object.values(selectedLands).reduce((a, b) => a + b, 0)

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

  const addCard = (id) =>
    setSelectedCards((p) => ({ ...p, [id]: Math.min((p[id] || 0) + 1, 3) }))

  const removeCard = (id) =>
    setSelectedCards((p) => {
      const next = { ...p, [id]: (p[id] || 0) - 1 }
      if (next[id] <= 0) delete next[id]
      return next
    })

  const addLand = (id) =>
    landTotal < 4 && setSelectedLands((p) => ({ ...p, [id]: (p[id] || 0) + 1 }))

  const removeLand = (id) =>
    setSelectedLands((p) => {
      const next = { ...p, [id]: (p[id] || 0) - 1 }
      if (next[id] <= 0) delete next[id]
      return next
    })

  const errors = [
    ...(cardTotal > 40 ? ['В колоде больше 40 карт'] : []),
    ...(landTotal !== 4 ? ['Выбрано не 4 земли'] : []),
  ]

  const warnings = cardTotal < 40 ? ['В колоде меньше 40 карт'] : []

  const saveDeck = async () => {
    const code = deckCode || `DK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
    const { error } = await supabase.from('decks').upsert({
      name: deckName,
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
      setDeckCode(code)
      toast('success', '✅ Колода сохранена')
    }
  }

  const importDeck = async (code) => {
    const { data, error } = await supabase.from('decks').select('*').eq('code', code).single()

    if (error || !data) {
      toast('error', 'Колода не найдена')
    } else {
      setDeckName(data.name)
      setDeckCode(data.code)
      setSelectedCards(Object.fromEntries(data.cards.map((x) => [x.card_id, x.quantity])))
      setSelectedLands(Object.fromEntries(data.lands.map((x) => [x.land_id, x.quantity])))
      toast('success', '✅ Колода импортирована')
    }
  }

  const clearDeck = () => {
    if (window.confirm('Очистить колоду?')) {
      setSelectedCards({})
      setSelectedLands({})
      setDeckName('')
      setDeckCode('')
    }
  }

  return (
    <main className="app">
      <TopBar
        name={deckName}
        setName={setDeckName}
        cardTotal={cardTotal}
        landTotal={landTotal}
        errors={errors}
        warnings={warnings}
        save={saveDeck}
        clear={clearDeck}
        importDeck={importDeck}
        selectedCards={selectedCards}
        selectedLands={selectedLands}
        onAdminClick={onAdminClick}
      />

      <button className="panel-button" onClick={() => setDeckModalOpen(true)}>
        🎒 Твоя колода
      </button>

      <DeckModal
        open={deckModalOpen}
        onClose={() => setDeckModalOpen(false)}
        selectedCards={selectedCards}
        selectedLands={selectedLands}
        cards={cards}
        lands={lands}
        removeCard={removeCard}
        removeLand={removeLand}
      />

      <div className="layout">
        <DeckFilters filters={filters} setFilters={setFilters} mode={mode} setMode={setMode} />

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
