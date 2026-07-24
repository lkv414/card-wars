import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getGuestNickname, setGuestNickname } from '../../utils/guestId'
import { useLobby } from '../../hooks/useLobby'
import { useStartGame } from '../../hooks/useStartGame'
import { supabase } from '../../utils/supabase'
import { LobbyRoom } from './LobbyRoom'
import './Lobby.css'

export function LobbyScreen({ toast }) {
  const navigate = useNavigate()
  const { code: codeFromUrl } = useParams()
  const [nickname, setNickname] = useState(getGuestNickname)
  const [joinCode, setJoinCode] = useState(codeFromUrl ?? '')

  const { status, players, error, isHost, hostId, lobbyId, lobbyCode, dismissedMessage, createLobby, joinLobby, setReady, leaveLobby } = useLobby()
  const { startGame } = useStartGame()

  // Когда статус 'in_game' — найти gameId для этого лобби и перейти.
  // Retry: после старта игры Realtime может прийти быстрее, чем INSERT в games
  // зафиксируется для SELECT — поэтому пробуем до 5 раз с задержкой.
  useEffect(() => {
    if (status !== 'in_game' || !lobbyId) return
    let cancelled = false
    let attempts = 0
    const maxAttempts = 8
    const findGameAndGo = async () => {
      while (attempts < maxAttempts && !cancelled) {
        attempts++
        try {
          const { data } = await supabase
            .from('games')
            .select('id')
            .eq('lobby_id', lobbyId)
            .maybeSingle()
          if (cancelled) return
          if (data?.id) {
            navigate(`/game/${data.id}`)
            return
          }
          // Ещё нет — ждём 400ms и пробуем снова
          await new Promise((r) => setTimeout(r, 400))
        } catch (err) {
          toast?.('error', 'Не удалось найти игру: ' + (err?.message || err))
          return
        }
      }
      if (!cancelled) {
        toast?.('error', 'Игра создаётся, но не найдена. Обновите страницу.')
      }
    }
    findGameAndGo()
    return () => { cancelled = true }
  }, [status, lobbyId, navigate, toast])

  const handleStartGame = async () => {
    if (!lobbyId) return
    const result = await startGame(lobbyId)
    if (result?.error) {
      toast?.('error', result.error)
    }
  }

  // Обновить URL когда код лобби становится известен
  useEffect(() => {
    if (lobbyCode) {
      navigate(`/lobby/${lobbyCode}`, { replace: true })
    }
  }, [lobbyCode, navigate])

  // Если открыли прямую ссылку /lobby/:code — сразу показать форму со вписанным кодом
  // Автовход не делаем — нужен никнейм

  const handleCreate = async () => {
    if (!nickname.trim()) {
      toast?.('error', 'Введите никнейм')
      return
    }
    setGuestNickname(nickname)
    await createLobby(nickname)
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
  }

  const handleLeave = async () => {
    await leaveLobby()
    navigate('/lobby', { replace: true })
  }

  // Пока восстанавливаем сессию из localStorage — показываем заглушку
  if (status === 'restoring') {
    return (
      <main className="lobby-screen">
        <div className="lobby-screen__content">
          <p className="lobby-restoring">Загрузка...</p>
        </div>
      </main>
    )
  }

  // Показать комнату если есть активное лобби (в т.ч. восстановленное из localStorage)
  if (status === 'waiting' || status === 'in_game') {
    return (
      <LobbyRoom
        code={lobbyCode ?? ''}
        players={players}
        status={status}
        isHost={isHost}
        hostId={hostId}
        onReady={setReady}
        onLeave={handleLeave}
        onStartGame={handleStartGame}
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
                {status === 'loading' && !joinCode ? 'Создаём...' : 'Создать комнату'}
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
                {status === 'loading' && joinCode ? 'Входим...' : 'Войти'}
              </button>
            </div>
          </div>

          {dismissedMessage && <p className="lobby-error">{dismissedMessage}</p>}
          {error && <p className="lobby-error">{error}</p>}
        </div>
      </div>
    </main>
  )
}
