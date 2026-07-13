import { useState } from 'react'
import { useCards } from './hooks/useCards'
import { useLands } from './hooks/useLands'
import { useToasts } from './hooks/useToasts'
import './App.css'

import { MainMenu } from './components/MainMenu'
import { DeckBuilder } from './components/DeckBuilder'
import { AdminPanel } from './components/AdminPanel'
import { Toasts } from './components/Shared/Toasts'

function App() {
  // Состояние для переключения экранов
  const [screen, setScreen] = useState('main-menu') // 'main-menu', 'deck', 'admin'

  const {
    cards,
    loading: loadingCards,
    error: cardsError,
    createCard,
    updateCard,
    deleteCard,
    findSimilarCards,
  } = useCards()
  const { lands, loading: loadingLands, error: landsError } = useLands()

  const loadingLibrary = loadingCards || loadingLands
  const libraryError = cardsError || landsError || ''

  const { toasts, toast } = useToasts()

  // Обработчики переключения экранов
  const handleJoinGame = (data) => {
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

  return (
    <>
      {screen === 'main-menu' && <MainMenu onJoin={handleJoinGame} onDeckBuilder={handleGoToDeckBuilder} />}

      {screen === 'deck' && (
        <DeckBuilder
          cards={cards}
          lands={lands}
          loadingLibrary={loadingLibrary}
          libraryError={libraryError}
          onAdminClick={handleGoToAdmin}
          onBackToMenu={handleBackToMenu}
          toast={toast}
        />
      )}

      {screen === 'admin' && (
        <AdminPanel
          cards={cards}
          toast={toast}
          goBack={handleBackToMenu}
          createCard={createCard}
          updateCard={updateCard}
          deleteCard={deleteCard}
          findSimilarCards={findSimilarCards}
        />
      )}

      <Toasts toasts={toasts} />
    </>
  )
}

export default App
