import { useState } from 'react'
import { getGuestId } from '../../utils/guestId'
import { copyToClipboard } from '../../utils/clipboard'
import { isLobbyDeckPlayable } from '../../utils/lobbyDeck'
import { LAND_PLACEMENT_RULES, LAND_PLACEMENT_RULE_LABELS } from '../../constants/game'
import './Lobby.css'

export function LobbyRoom({ code, players, onlinePlayerIds = [], status, isHost, hostId, onReady, onLeave, onStartGame, toast }) {
  const [copied, setCopied] = useState(false)
  const [landPlacementRule, setLandPlacementRule] = useState(LAND_PLACEMENT_RULES.STRICT)
  const guestId = getGuestId()

  const myPlayer = players.find(p => p.player_id === guestId)
  const amReady = myPlayer?.ready ?? false
  const myHasDeck = isLobbyDeckPlayable(myPlayer?.deck)
  const allHaveDecks = players.length >= 2 && players.every(p => isLobbyDeckPlayable(p.deck))
  const missingDeckNames = players
    .filter(p => !isLobbyDeckPlayable(p.deck))
    .map(p => p.nickname || p.player_id.slice(0, 6))

  const handleCopy = async () => {
    const url = `${window.location.origin}/lobby/${code}`
    const ok = await copyToClipboard(url)
    if (!ok) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleReady = () => {
    if (!myHasDeck) {
      toast?.('error', 'Нет колоды — выйдите и зайдите снова с выбранной колодой')
      return
    }
    onReady?.()
  }

  const handleStart = () => {
    if (!allHaveDecks) {
      toast?.('error', `Ждём колоды: ${missingDeckNames.join(', ')}`)
      return
    }
    onStartGame?.(landPlacementRule)
  }

  return (
    <main className="lobby-room" role="main">
      <div className="lobby-room__content">
        <button className="lobby-back-btn" onClick={onLeave} aria-label="Выйти из лобби">
          ← Выйти из лобби
        </button>

        <h1>Лобби</h1>

        <div className="lobby-code-display">
          <span className="lobby-code-label">Код комнаты</span>
          <div className="lobby-code-value">
            <span>{code}</span>
            <button className="lobby-copy-btn" onClick={handleCopy} title="Скопировать код" aria-label={copied ? 'Код скопирован' : 'Скопировать код'}>
              {copied ? '✓' : '⎘'}
            </button>
          </div>
          <p className="lobby-code-hint">Поделитесь этим кодом с другом</p>
        </div>

        <div className="lobby-players">
          <h2>Игроки ({players.length}/4)</h2>
          <ul className="lobby-players__list">
            {players.map(p => {
              const hasDeck = isLobbyDeckPlayable(p.deck)
              const deckName = p.deck?.name
              const cardCount = p.deck?.cardCount ?? p.deck?.cards?.length
              const isOnline = onlinePlayerIds.includes(p.player_id)
              return (
                <li key={p.player_id} className="lobby-player">
                  <div className="lobby-player__info">
                    <span className="lobby-player__name">
                      <span
                        className={`lobby-player__online ${isOnline ? 'lobby-player__online--on' : ''}`}
                        title={isOnline ? 'В сети' : 'Не в сети'}
                        aria-hidden="true"
                      />
                      {p.player_id === hostId && <span className="lobby-player__host" title="Хост">♛ </span>}
                      {p.nickname || `Игрок ${p.player_id.slice(0, 6).toUpperCase()}`}
                      {p.player_id === guestId && <span className="lobby-player__you"> (вы)</span>}
                    </span>
                    <span className={`lobby-player__deck ${hasDeck ? 'ok' : 'missing'}`}>
                      {hasDeck
                        ? `🃏 ${deckName || 'Колода'}${cardCount != null ? ` · ${cardCount}` : ''}`
                        : '⚠ нет колоды'}
                    </span>
                  </div>
                  <span className={`lobby-player__status ${p.ready ? 'ready' : 'waiting'}`}>
                    {p.ready ? '✓ Готов' : 'Ожидание...'}
                  </span>
                </li>
              )
            })}

            {Array.from({ length: Math.max(0, 4 - players.length) }).map((_, i) => (
              <li key={`empty-${i}`} className="lobby-player lobby-player--empty">
                <span className="lobby-player__name">Свободное место</span>
                <span className="lobby-player__status waiting">—</span>
              </li>
            ))}
          </ul>
          {players.length < 2 && (
            <p className="lobby-players__hint">Нужно минимум 2 игрока для старта</p>
          )}
          {players.length >= 2 && !allHaveDecks && (
            <p className="lobby-players__hint lobby-players__hint--warn">
              Без колоды: {missingDeckNames.join(', ')}. Нужно выбрать колоду и перезайти.
            </p>
          )}
        </div>

        {status === 'in_game' ? (
          <div className="lobby-game-start">
            <p>Игра началась! Подключаем...</p>
          </div>
        ) : (
          <>
            <button
              className={`lobby-btn ${amReady ? 'lobby-btn--ready-done' : 'lobby-btn--ready'}`}
              onClick={handleReady}
              disabled={amReady || players.length < 2 || !myHasDeck}
              aria-pressed={amReady}
              aria-label={amReady ? 'Вы уже готовы' : 'Отметить себя готовым'}
              title={
                !myHasDeck
                  ? 'Нет колоды'
                  : players.length < 2
                    ? 'Нужно минимум 2 игрока'
                    : undefined
              }
            >
              {amReady ? '✓ Вы готовы' : 'Готов'}
            </button>

            {isHost && players.length >= 2 && (
              <div className="lobby-settings" role="group" aria-label="Правила земель">
                <span className="lobby-settings__label">Типизация земель</span>
                <div className="lobby-settings__options">
                  {Object.values(LAND_PLACEMENT_RULES).map((rule) => (
                    <button
                      key={rule}
                      type="button"
                      className={`lobby-settings__opt ${landPlacementRule === rule ? 'is-active' : ''}`}
                      aria-pressed={landPlacementRule === rule}
                      onClick={() => setLandPlacementRule(rule)}
                    >
                      {LAND_PLACEMENT_RULE_LABELS[rule]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isHost && players.length >= 2 && (
              <button
                className="lobby-btn lobby-btn--start"
                onClick={handleStart}
                disabled={!allHaveDecks}
                aria-disabled={!allHaveDecks}
                aria-label={allHaveDecks ? 'Начать игру' : `Нужно выбрать колоды: ${missingDeckNames.join(', ')}`}
              >
                ▶ Начать игру
              </button>
            )}
          </>
        )}
      </div>
    </main>
  )
}
