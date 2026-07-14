import { useState } from 'react'
import { navigate, ROUTES } from '../router'
import './MainMenu.css'

export function MainMenu({ onJoin, toast }) {
  const [nickname, setNickname] = useState('')
  const [roomCode, setRoomCode] = useState('')

  const handleJoin = () => {
    if (!nickname.trim()) {
      toast?.('error', 'Введите никнейм')
      return
    }
    onJoin({ nickname, roomCode })
  }

  return (
    <main className="main-menu">
      <div className="main-menu-content">
        <h1>Card Game</h1>

        <div className="main-menu-form">
          <div className="form-group">
            <label htmlFor="nickname">Никнейм</label>
            <input
              id="nickname"
              type="text"
              placeholder="Введите ваш никнейм"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            />
          </div>

          <div className="form-group">
            <label htmlFor="roomCode">Код комнаты</label>
            <input
              id="roomCode"
              type="text"
              placeholder="Код комнаты (опционально)"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            />
          </div>

          <button type="button" className="btn-join" onClick={handleJoin}>
            Присоединиться
          </button>

          <button type="button" className="btn-editor" onClick={() => navigate(ROUTES.deck)}>
            Редактор колод
          </button>
        </div>
      </div>
    </main>
  )
}
