import { useState } from 'react'
import { getGuestNickname, setGuestNickname } from '../../utils/guestId'
import { useLobby } from '../../hooks/useLobby'
import { LobbyRoom } from './LobbyRoom'
import { navigate } from '../../router'
import './Lobby.css'

export function LobbyScreen({ toast }) {
  const [nickname, setNickname] = useState(getGuestNickname)
  const [joinCode, setJoinCode] = useState('')
  const [mode, setMode] = useState(null) // null | 'host' | 'join'
  const [lobbyCode, setLobbyCode] = useState(null)

  const { status, players, error, isHost, hostId, createLobby, joinLobby, setReady, leaveLobby } = useLobby()

  const handleCreate = async () => {
    if (!nickname.trim()) {
      toast?.('error', 'Введите никнейм')
      return
    }
    setGuestNickname(nickname)
    const code = await createLobby(nickname)
    if (code) {
      setLobbyCode(code)
      setMode('host')
    }
  }

  const handleJoin = async () => {
    if (!nickname.trim()) {
      toast?.('error', 'Введите никнейм')
      return
    }
    if (!joinCode.trim()) {
      toast?.('error', 'Введите код лобби')
      return
    }
    setGuestNickname(nickname)
    await joinLobby(joinCode, nickname)
    setMode('join')
  }

  const handleLeave = async () => {
    await leaveLobby()
    setMode(null)
    setLobbyCode(null)
  }

  // Показать комнату, если вошли / создали
  if (mode && (status === 'waiting' || status === 'in_game' || status === 'loading')) {
    return (
      <LobbyRoom
        code={lobbyCode ?? joinCode.trim().toUpperCase()}
        players={players}
        status={status}
        isHost={isHost}
        hostId={hostId}
        onReady={setReady}
        onLeave={handleLeave}
        toast={toast}
      />
    )
  }

  return (
    <main className="lobby-screen">
      <div className="lobby-screen__content">
        <button className="lobby-back-btn" onClick={() => navigate('/')}>
          ← Назад
        </button>

        <h1>Онлайн игра</h1>

        <div className="lobby-form">
          <div className="lobby-form__group">
            <label htmlFor="lob-nickname">Ваш никнейм</label>
            <input
              id="lob-nickname"
              type="text"
              maxLength={24}
              placeholder="Введите никнейм"
              value={nickname}
              onChange={e => setNickname(e.target.value)}
            />
          </div>

          <div className="lobby-divider">
            <div className="lobby-option">
              <h2>Создать лобби</h2>
              <p>Вы получите код — поделитесь им с другом</p>
              <button
                className="lobby-btn lobby-btn--create"
                onClick={handleCreate}
                disabled={status === 'loading'}
              >
                {status === 'loading' && mode !== 'join' ? 'Создаём...' : 'Создать комнату'}
              </button>
            </div>

            <span className="lobby-or">или</span>

            <div className="lobby-option">
              <h2>Войти по коду</h2>
              <div className="lobby-form__group">
                <input
                  type="text"
                  maxLength={6}
                  placeholder="XXXXXX"
                  value={joinCode}
                  onChange={e => setJoinCode(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && handleJoin()}
                  className="lobby-code-input"
                />
              </div>
              <button
                className="lobby-btn lobby-btn--join"
                onClick={handleJoin}
                disabled={status === 'loading'}
              >
                {status === 'loading' && mode === 'join' ? 'Входим...' : 'Войти'}
              </button>
            </div>
          </div>

          {error && <p className="lobby-error">{error}</p>}
        </div>
      </div>
    </main>
  )
}
