import { navigate, ROUTES } from '../router'
import './MainMenu.css'

export function MainMenu({ onJoin }) {
  return (
    <main className="main-menu">
      <div className="main-menu-content">
        <h1>Card Game</h1>

        <div className="main-menu-form">
          <button type="button" className="btn-join" onClick={onJoin}>
            Играть онлайн
          </button>

          <button type="button" className="btn-editor" onClick={() => navigate(ROUTES.deck)}>
            Редактор колод
          </button>
        </div>
      </div>
    </main>
  )
}
