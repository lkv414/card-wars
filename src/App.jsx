import { useEffect, useState } from 'react'
import { generateDeckCode, decodeDeckCode } from './utils/deckCode'
import { supabase } from './utils/supabase'
import './App.css'

import { MainMenu } from './components/MainMenu'
import { DeckBuilder } from './components/DeckBuilder'
import { AdminPanel } from './components/AdminPanel'
import { Toasts } from './components/Shared/Toasts'

function App() {
  // Состояние для переключения экранов
  const [screen, setScreen] = useState('main-menu') // 'main-menu', 'deck', 'admin'

  // Состояние для карт и земель
  const [cards, setCards] = useState([])
  const [lands, setLands] = useState([])
  const [loadingLibrary, setLoadingLibrary] = useState(true)
  const [libraryError, setLibraryError] = useState('')

  // Состояние для тостов
  const [toasts, setToasts] = useState([])

  // Функция для создания тостов
  const toast = (type, text) => {
    const id = crypto.randomUUID()
    setToasts((p) => [...p, { id, type, text }])
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3000)
  }

  // Загрузка библиотеки карт и земель из Supabase
  useEffect(() => {
    let cancelled = false

    async function loadLibrary() {
      setLoadingLibrary(true)
      setLibraryError('')
      const [cardsResult, landsResult] = await Promise.all([
        supabase.from('cards').select('*').order('card_number'),
        supabase.from('lands').select('*').order('name'),
      ])

      console.log('📋 Результаты Supabase:')
      console.log('Cards:', cardsResult)
      console.log('Lands:', landsResult)

      if (cancelled) return

      if (cardsResult.error || landsResult.error) {
        console.error('❌ Ошибка Supabase:', cardsResult.error || landsResult.error)
        setCards([])
        setLands([])
        setLibraryError(
          cardsResult.error?.message || landsResult.error?.message || 'Не удалось загрузить данные из Supabase'
        )
      } else {
        console.log('✅ Загружено карт:', cardsResult.data?.length, 'Земель:', landsResult.data?.length)
        setCards(cardsResult.data || [])
        setLands(landsResult.data || [])
        // Temporary globals for debugging in DevTools console
        try {
          window.__debug_cards = cardsResult.data || []
          window.__debug_lands = landsResult.data || []
          console.debug('[App] exported debug globals', {
            __debug_cards_count: window.__debug_cards.length,
            __debug_lands_count: window.__debug_lands.length,
          })
        } catch (e) {
          // ignore if window is not available
        }
        // Round-trip test: take first card, generate code, decode and compare
        try {
          const first = (cardsResult.data && cardsResult.data[0]) || null
          if (first && first.id) {
            const roundCode = generateDeckCode({ [first.id]: 1 }, {})
            const roundDecoded = decodeDeckCode(roundCode)
            console.debug('[App] roundtrip deckCode test', {
              firstCardId: first.id,
              generatedCode: roundCode,
              decodedJson: JSON.stringify(roundDecoded || {}),
              decodedCards: roundDecoded?.selectedCards || null,
              match: !!(roundDecoded && roundDecoded.selectedCards && roundDecoded.selectedCards[first.id] === 1),
            })
          } else {
            console.debug('[App] roundtrip deckCode test skipped: no first card')
          }
        } catch (e) {
          console.error('[App] roundtrip deckCode test error', e)
        }
      }
      setLoadingLibrary(false)
    }

    loadLibrary()
    return () => {
      cancelled = true
    }
  }, [])

  // Обработчики переключения экранов
  const handleJoinGame = (data) => {
    console.log('Присоединился игрок:', data)
    // TODO: Реализовать присоединение к игре
  }

  const handleGoToDeckBuilder = () => {
    setScreen('deck')
  }

  const handleGoToAdmin = () => {
    setScreen('admin')
  }

  const handleBackToMenu = () => {
    setScreen('main-menu')
  }

  // Отрисовка экранов
  if (screen === 'main-menu') {
    return (
      <>
        <MainMenu onJoin={handleJoinGame} onDeckBuilder={handleGoToDeckBuilder} />
        <Toasts toasts={toasts} />
      </>
    )
  }

  if (screen === 'deck') {
    return (
      <>
        <DeckBuilder
          cards={cards}
          lands={lands}
          loadingLibrary={loadingLibrary}
          libraryError={libraryError}
          onAdminClick={handleGoToAdmin}
          onBackToMenu={handleBackToMenu}
        />
        <Toasts toasts={toasts} />
      </>
    )
  }

  if (screen === 'admin') {
    return (
      <>
        <AdminPanel cards={cards} setCards={setCards} toast={toast} goBack={handleBackToMenu} />
        <Toasts toasts={toasts} />
      </>
    )
  }

  return null
}

export default App
