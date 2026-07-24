import { useNavigate } from 'react-router-dom'
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

          <button type="button" className="btn-editor" onClick={() => navigate('/deck')}>
            Редактор колод
          </button>
        </div>
      </div>
    </main>
  )
}
