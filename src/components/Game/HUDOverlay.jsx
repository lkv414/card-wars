/**
 * HUDOverlay — 2D-оверлей над 3D-сценой GameBoard3D.
 *
 * Рендерится обычным DOM (вне <Canvas>), позиционируется absolute.
 * Содержит:
 *   - Кнопка выхода (в левом верхнем углу)
 *   - Центральный HUD (статус хода, HP, рука, колода, кнопки действий)
 *   - HUD противника (над его стороной)
 *   - Баннер дисконнекта (Realtime)
 *
 * Стили встроены inline, чтобы не плодить CSS-файлы.
 *
 * Все размеры/стили дублируют бывшие в GameBoard3D.jsx — рефакторинг
 * чисто структурный, визуал не меняется.
 */

import { useState } from 'react'
import { Replay } from './Replay'
import { safePlayer } from '../../utils/safePlayer'
import { logError } from '../../utils/errorLogger'

export function HUDOverlay({
  playerId,
  isYourTurn,
  isFinished,
  winnerId,
  me,
  opp,
  handCards,
  log,
  onEndTurn,
  onForfeit,
  onGameEnd,
  realtimeStatus,
  selectedCardIndex = null,
  setSelectedCardIndex = () => {},
  isApplying = false,
  actionError = null,
  onPlayCard = null, // (cardIndex, zoneIndex, myIndex) — для drag&drop
}) {
  const [draggingCardIndex, setDraggingCardIndex] = useState(null)
  const [justPlayedCardIndex, setJustPlayedCardIndex] = useState(null)
  const [justPlayedZoneIndex, setJustPlayedZoneIndex] = useState(null)
  const [isReplayOpen, setReplayOpen] = useState(false)

  // Защита: me/opp могут прийти undefined из Realtime или после forfeit.
  // safePlayer гарантирует health, hand, deck_pile, zones — никогда undefined.
  const safeMe = safePlayer([me].filter(Boolean), me?.player_id)
  const safeOpp = safePlayer([opp].filter(Boolean), opp?.player_id)

  return (
    <>
      {/* Кнопка выхода в лобби */}
      <button className="exit-btn" onClick={onGameEnd}>
        ← Выйти из игры
      </button>
      <button className="replay-open-btn" onClick={() => setReplayOpen(true)}>
        ⏮ Реплей ({Array.isArray(log) ? log.length : 0})
      </button>

      {isReplayOpen && <Replay log={log} onClose={() => setReplayOpen(false)} />}

      {/* HUD противника — сверху */}
      <div className="hud-opponent">
        Противник · ❤️ {safeOpp.health}/25 · 🂠 × {safeOpp.hand?.length || 0}
      </div>

      {/* Баннер разрыва связи */}
            {(realtimeStatus === 'disconnected' || realtimeStatus === 'reconnecting') && (
              <div className="connection-banner" role="alert" aria-live="polite">
                <span className="connection-spinner" />
                {realtimeStatus === 'disconnected'
                  ? '⚠️ Связь потеряна — переподключаемся...'
                  : '🔄 Переподключение к серверу...'}
              </div>
            )}

            {/* Банер ошибки действия — чтобы видеть почему «кнопка не работает» */}
            {actionError && (
              <div className="action-error-banner" role="alert">
                ❌ {actionError}
              </div>
            )}

            {/* Банер загрузки */}
            {isApplying && (
              <div className="action-pending-banner" role="status">
                ⏳ Отправляем действие...
              </div>
            )}

      {/* НИЖНЯЯ ПАНЕЛЬ: рука + кнопки. Это замена центрального «летающего» меню. */}
      <div className="hud-bottom">
        {/* Статус-баннер сверху панели */}
        <div className={`hud-bottom-status ${isYourTurn ? 'your' : 'opponent'} ${isFinished ? 'finished' : ''}`}>
          {isFinished
            ? `🎉 ${winnerId === playerId ? 'Вы выиграли!' : 'Вы проиграли!'}`
            : (isYourTurn ? '👉 Ваш ход' : '⏳ Ход противника')}
          <span className="hud-bottom-stats">
            ❤️ {safeMe.health}/25 · 📚 {safeMe.deck_pile?.length ?? safeMe.deck_remaining ?? 0}
          </span>
          {isYourTurn && !isFinished && (
                      <div className="hud-bottom-buttons">
                        <button
                          type="button"
                          className="hud-end-btn"
                          disabled={isApplying}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (typeof onEndTurn === 'function') {
                              Promise.resolve(onEndTurn()).catch((err) => {
                                logError(err, { component: 'HUDOverlay', action: 'endTurn' })
                              })
                            }
                          }}
                          title="Завершает ваш ход. Переходит к следующему игроку и добирает 1 карту."
                        >
                          {isApplying ? '⏳ Отправка…' : '⏭ Закончить ход'}
                        </button>
                        <button
                          type="button"
                          className="hud-forfeit-btn"
                          disabled={isApplying}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (typeof onForfeit === 'function') {
                              Promise.resolve(onForfeit()).catch((err) => {
                                logError(err, { component: 'HUDOverlay', action: 'forfeit' })
                              })
                            }
                          }}
                          title="Сдаться — оппонент победит"
                        >
                          🏳️ Сдаться
                        </button>
                      </div>
                    )}
        </div>

        {/* Горизонтальная полоса карт руки. Click — выбор, Drag — перенос на землю. */}
                {isYourTurn && !isFinished && draggingCardIndex !== null && (
                  <div className="hud-drop-zones" role="group" aria-label="Земли для размещения">
                    {[0, 1, 2, 3].map((idx) => {
                      // Узнаём, пуст ли слот idx (через пропсы не передано — берём из me)
                      const zone = me?.zones?.[idx] || {}
                      const cards = Array.isArray(zone) ? zone : zone.cards || []
                      const isEmpty = !Array.isArray(cards) || cards.length === 0
                      let wasDragged = false
                      const handleDrop = (e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        if (isApplying) return
                        wasDragged = true
                        if (!isEmpty || draggingCardIndex === null) return
                        setDraggingCardIndex(null)
                        if (typeof onPlayCard === 'function') {
                          setJustPlayedCardIndex(draggingCardIndex)
                          setJustPlayedZoneIndex(idx)
                          setTimeout(() => {
                            setJustPlayedCardIndex(null)
                            setJustPlayedZoneIndex(null)
                            wasDragged = false
                          }, 1800)
                          Promise.resolve(onPlayCard(draggingCardIndex, idx, 1)).catch((err) => {
                            logError(err, { component: 'HUDOverlay', action: 'playCard' })
                          })
                        }
                      }
                                            const handleClick = (e) => {
                                              if (wasDragged) return
                                              handleDrop(e)
                                            }
                                            return (
                                              <button
                                                type="button"
                                                key={`drop-zone-${idx}`}
                                                className={`hud-drop-zone${isEmpty ? ' empty' : ' full'}`}
                                                disabled={!isEmpty}
                                                onClick={handleClick}
                                                onDragOver={(e) => {
                                                  e.stopPropagation()
                                                  e.preventDefault()
                                                }}
                                                onDrop={handleDrop}
                                                onDragEnd={() => {
                                                  wasDragged = true
                                                  setTimeout(() => { wasDragged = false }, 100)
                                                }}
                                                title={isEmpty ? `Разместить на земле ${idx + 1}` : 'Земля занята'}
                                                aria-label={
                                                  isEmpty
                                                    ? `Земля ${idx + 1}, свободна`
                                                    : `Земля ${idx + 1}, занята`
                                                }
                                              >
                          <span className="hud-drop-zone-num">{idx + 1}</span>
                          <span className="hud-drop-zone-label">{isEmpty ? 'Свободно' : 'Занято'}</span>
                        </button>
                      )
                    })}
                  </div>
                )}

                <div className="hud-hand" role="list" aria-label="Ваша рука">
                  {Array.isArray(handCards) && handCards.length > 0 ? (
                    handCards.map((c, idx) => {
                      const isSel = selectedCardIndex === idx
                      const isDragging = draggingCardIndex === idx
                      return (
                        <button
                          type="button"
                          key={c?.id || c?.instanceId || idx}
                          className={`hud-hand-card${isSel ? ' selected' : ''}${isDragging ? ' dragging' : ''}${justPlayedCardIndex === idx ? ' just-played' : ''}${isYourTurn ? '' : ' disabled'}`}
                          disabled={!isYourTurn || isFinished}
                          draggable={Boolean(isYourTurn && !isFinished && onPlayCard)}
                          onClick={(e) => {
                            e.stopPropagation()
                            e.preventDefault()
                            setSelectedCardIndex(isSel ? null : idx)
                          }}
                          onDragStart={(e) => {
                            if (!isYourTurn || isFinished || isApplying) {
                              e.preventDefault()
                              return
                            }
                            setDraggingCardIndex(idx)
                            setSelectedCardIndex(idx)
                            e.dataTransfer.setData('text/plain', String(idx))
                            e.dataTransfer.effectAllowed = 'move'
                          }}
                          onDragEnd={() => {
                            setDraggingCardIndex(null)
                          }}
                          onPointerDown={() => {
                            // На мобильных drag может не сработать; выбираем карту по тапу
                            if (isYourTurn && !isFinished) {
                              setSelectedCardIndex(isSel ? null : idx)
                            }
                          }}
                          aria-pressed={isSel}
                          aria-label={c?.name ?? `Карта ${idx + 1}`}
                          title={c?.name || `Карта ${idx + 1}`}
                        >
                  {c?.image_url ? (
                    <img
                      src={c.image_url}
                      alt=""
                      className="hud-hand-card-img"
                      draggable={false}
                    />
                  ) : (
                    <span className="hud-hand-card-fallback">{c?.name || `Карта ${idx + 1}`}</span>
                  )}
                </button>
              )
            })
          ) : (
            <div className="hud-hand-empty">Рука пуста</div>
          )}
        </div>
      </div>

      <style>{`
        /* === НИЖНЯЯ ПАНЕЛЬ (замена центрального летающего меню) === */
        .hud-bottom {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 60; /* выше Canvas, не перекрыт */
          background: linear-gradient(180deg, rgba(10,10,30,0) 0%, rgba(10,10,30,0.92) 30%, rgba(10,10,30,0.98) 100%);
          padding: 14px 18px 18px 18px;
          font-family: 'Segoe UI', system-ui, sans-serif;
          color: white;
          pointer-events: auto; /* кликабельна вся панель */
        }
        .hud-bottom-status {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 10px;
          flex-wrap: wrap;
          font-weight: 700;
          font-size: 16px;
        }
        .hud-bottom-status.your { color: #4caf50; }
        .hud-bottom-status.opponent { color: #ff9800; }
        .hud-bottom-status.finished { font-size: 22px; color: #ffd700; }
        .hud-bottom-stats {
          font-weight: 500;
          opacity: 0.85;
          font-size: 14px;
          margin-left: auto;
        }
        .hud-bottom-buttons { display: flex; gap: 10px; }
        /* Кнопки получают pointer-events: auto, и стоят выше Canvas. */
        .hud-end-btn, .hud-forfeit-btn {
          padding: 8px 18px;
          color: white;
          font-weight: 700;
          font-size: 14px;
          border-radius: 6px;
          cursor: pointer;
          border: none;
          pointer-events: auto;
          z-index: 61;
        }
        .hud-end-btn {
          background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%);
        }
        .hud-end-btn:hover { filter: brightness(1.15); }
        .hud-forfeit-btn {
          background: rgba(244, 67, 54, 0.85);
          border: 1px solid rgba(255, 255, 255, 0.2);
        }
        .hud-forfeit-btn:hover { background: rgba(244, 67, 54, 1); }

        /* === РУКА (горизонтальная полоса карт) === */
                .hud-hand {
                  display: flex;
                  gap: 10px;
                  overflow-x: auto;
                  padding-bottom: 6px;
                  pointer-events: auto;
                }
                .hud-hand-card {
                  flex: 0 0 auto;
                  width: 92px;
                  height: 128px;
                  padding: 0;
                  border-radius: 8px;
                  background: #111;
                  border: 2px solid rgba(255, 255, 255, 0.2);
                  color: white;
                  cursor: grab;
                  display: block;
                  font-family: 'Segoe UI', system-ui, sans-serif;
                  text-align: left;
                  pointer-events: auto;
                  position: relative;
                  overflow: hidden;
                  transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
                  user-select: none;
                  touch-action: none;
                }
                .hud-hand-card:active { cursor: grabbing; }
                .hud-hand-card:hover { transform: translateY(-3px); border-color: rgba(255,255,255,0.5); }
                .hud-hand-card.selected {
                  border-color: #4caf50;
                  box-shadow: 0 0 16px rgba(76, 175, 80, 0.6);
                  transform: translateY(-4px);
                }
                /* Активный drag — карта становится полупрозрачной в исходном месте */
                .hud-hand-card.dragging { opacity: 0.35; }
                .hud-hand-card.disabled { opacity: 0.45; cursor: not-allowed; }
        .hud-hand-card-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center;
          display: block;
          pointer-events: none;
          user-select: none;
        }
        .hud-hand-card-fallback {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          padding: 8px;
          font-size: 11px;
          font-weight: 700;
          line-height: 1.2;
          text-align: center;
          background: linear-gradient(135deg, #2a3554 0%, #1f2940 100%);
        }
        .hud-hand-empty { color: rgba(255,255,255,0.5); font-style: italic; }

        /* === Drop-зоны (появляются когда карта зажата) === */
        .hud-drop-zones {
          display: flex;
          gap: 10px;
          margin-bottom: 10px;
          padding: 8px;
          background: rgba(76, 175, 80, 0.15);
          border: 1px dashed rgba(76, 175, 80, 0.5);
          border-radius: 8px;
          animation: drop-zone-pulse 1.5s ease-in-out infinite;
          pointer-events: auto;
        }
        @keyframes drop-zone-pulse {
          0%, 100% { background: rgba(76, 175, 80, 0.12); }
          50% { background: rgba(76, 175, 80, 0.22); }
        }
        .hud-drop-zone {
          flex: 1;
          min-width: 90px;
          padding: 10px 14px;
          border-radius: 6px;
          background: linear-gradient(135deg, #2c4a35 0%, #1a2e22 100%);
          border: 2px solid rgba(76, 175, 80, 0.4);
          color: white;
          font-family: 'Segoe UI', system-ui, sans-serif;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          pointer-events: auto;
          transition: all 0.15s ease;
          user-select: none;
        }
        .hud-drop-zone:hover:not(:disabled) {
          background: linear-gradient(135deg, #4caf50 0%, #2c7d2c 100%);
          border-color: #66ff66;
          transform: translateY(-3px);
          box-shadow: 0 6px 20px rgba(76, 175, 80, 0.5);
        }
        .hud-drop-zone:disabled {
          background: rgba(60, 60, 60, 0.5);
          border-color: rgba(255, 100, 100, 0.3);
          cursor: not-allowed;
          opacity: 0.55;
        }
        .hud-drop-zone-num {
          font-size: 18px;
          font-weight: 800;
          color: #4caf50;
        }
        .hud-drop-zone.full .hud-drop-zone-num {
          color: #ff5252;
        }
        .hud-drop-zone-label {
          font-size: 11px;
          opacity: 0.85;
        }

        /* === Визуальное обозначение «карта встала» === */
        /* Когда карта поставлена — на её бывшем месте в руке мигает «✅ Выложено» */
        .hud-hand-card.just-played {
          opacity: 0.35;
          pointer-events: none;
          animation: just-played-glow 1.5s ease-out;
        }
        @keyframes just-played-glow {
          0% { box-shadow: 0 0 24px rgba(76, 175, 80, 0.9); transform: translateY(-6px) scale(1.05); }
          100% { box-shadow: 0 0 0 rgba(76, 175, 80, 0); transform: translateY(0) scale(1); }
        }
        .hud-just-played-toast {
          position: absolute;
          bottom: 200px;
          left: 50%;
          transform: translateX(-50%);
          padding: 12px 24px;
          background: linear-gradient(135deg, #4caf50 0%, #2c7d2c 100%);
          color: white;
          font-weight: 700;
          font-size: 16px;
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(76, 175, 80, 0.6);
          z-index: 70;
          pointer-events: none;
          animation: toast-fly 1.8s ease-out forwards;
        }
        @keyframes toast-fly {
          0% { opacity: 0; transform: translate(-50%, 20px); }
          15% { opacity: 1; transform: translate(-50%, 0); }
          85% { opacity: 1; transform: translate(-50%, -10px); }
          100% { opacity: 0; transform: translate(-50%, -40px); }
        }

        /* Старые правила оставлены на случай если где-то в React-неиспользуемых местах */
        .hud-opponent {
          position: absolute;
          top: 80px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(20, 20, 50, 0.7);
          padding: 6px 14px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.15);
          color: rgba(255, 255, 255, 0.85);
          font-size: 13px;
          font-family: 'Segoe UI', system-ui, sans-serif;
          z-index: 40;
        }
        .exit-btn {
          position: absolute;
          top: 12px;
          left: 12px;
          padding: 6px 14px;
          background: rgba(0,0,0,0.5);
          color: white;
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 6px;
          cursor: pointer;
          z-index: 100;
          font-family: 'Segoe UI', system-ui, sans-serif;
        }
        .exit-btn:hover { background: rgba(0,0,0,0.8); }
        .replay-open-btn {
          position: absolute;
          top: 12px;
          left: 166px;
          padding: 6px 14px;
          background: rgba(59, 130, 246, 0.72);
          color: white;
          border: 1px solid rgba(147, 197, 253, 0.35);
          border-radius: 6px;
          cursor: pointer;
          z-index: 100;
          font-family: 'Segoe UI', system-ui, sans-serif;
        }
        .replay-open-btn:hover { background: rgba(59, 130, 246, 0.95); }
        .connection-banner {
          position: absolute;
          top: 12px;
          left: 50%;
          transform: translateX(-50%);
          padding: 10px 18px;
          background: rgba(244, 67, 54, 0.95);
          color: white;
          border-radius: 8px;
          font-weight: 700;
          font-family: 'Segoe UI', system-ui, sans-serif;
          font-size: 14px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.5);
          z-index: 100;
          display: flex;
          align-items: center;
          gap: 8px;
          animation: connection-pulse 1.5s ease-in-out infinite;
        }
        .connection-spinner {
                  display: inline-block;
                  width: 14px;
                  height: 14px;
                  border: 2px solid rgba(255,255,255,0.5);
                  border-top-color: white;
                  border-radius: 50%;
                  animation: connection-spin 0.8s linear infinite;
                }
                /* Банер ошибки — показывает почему «кнопка не работает» */
                .action-error-banner {
                  position: absolute;
                  top: 60px;
                  left: 50%;
                  transform: translateX(-50%);
                  z-index: 110;
                  padding: 10px 18px;
                  background: rgba(244, 67, 54, 0.95);
                  color: white;
                  font-weight: 700;
                  font-family: 'Segoe UI', system-ui, sans-serif;
                  font-size: 14px;
                  border-radius: 8px;
                  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
                  max-width: 80vw;
                  text-align: center;
                  pointer-events: auto;
                }
                .action-pending-banner {
                  position: absolute;
                  top: 60px;
                  left: 50%;
                  transform: translateX(-50%);
                  z-index: 110;
                  padding: 8px 16px;
                  background: rgba(59, 130, 246, 0.92);
                  color: white;
                  font-weight: 700;
                  font-family: 'Segoe UI', system-ui, sans-serif;
                  font-size: 13px;
                  border-radius: 8px;
                  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
                  pointer-events: none;
                }
                @keyframes connection-spin { to { transform: rotate(360deg); } }
        @keyframes connection-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }
              `}</style>

              {/* Визуальный фидбек «карта встала на землю» */}
              {justPlayedCardIndex !== null && justPlayedZoneIndex !== null && (
                <div className="hud-just-played-toast" role="status" aria-live="polite">
                  ✅ Карта #{justPlayedCardIndex + 1} выложена на землю {justPlayedZoneIndex + 1}
                </div>
              )}
            </>
  )
}
