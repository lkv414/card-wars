import { useNavigate } from 'react-router-dom'
import { isOfflineTestMode } from '../utils/offlineMode'
import './MainMenu.css'

export function MainMenu() {
  const navigate = useNavigate()

  return (
    <main className="main-menu">
      <div className="main-menu-content">
        <h1>Card Game</h1>

        <div className="main-menu-form">
          <button type="button" className="btn-join" onClick={() => navigate('/lobby')}>
            Играть онлайн
          </button>

          <button type="button" className="btn-editor" onClick={() => navigate('/decks')}>
            Мои колоды
          </button>

          {isOfflineTestMode && (
            <button
              type="button"
              className="btn-editor"
              onClick={() => navigate('/test-game/local-test')}
            >
              Тестовая игра без Supabase
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
