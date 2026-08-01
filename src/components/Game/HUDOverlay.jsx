/**
 * HUDOverlay — 2D-оверлей над 3D-сценой GameBoard3D.
 * Drag-and-drop карты из руки на зоны земли.
 */

import { useState, useCallback } from 'react'
import { Replay } from './Replay'
import { safePlayer } from '../../utils/safePlayer'

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
  onPlayCard = null,
  actionError = null,
}) {
  const [isReplayOpen, setReplayOpen] = useState(false)
  const [draggingIndex, setDraggingIndex] = useState(null)
  const [dragOverZone, setDragOverZone] = useState(null)
  const [localError, setLocalError] = useState(null)

  const safeMe = safePlayer([me].filter(Boolean), me?.player_id)
  const safeOpp = safePlayer([opp].filter(Boolean), opp?.player_id)

  const showDropZones =
    isYourTurn && !isFinished && (draggingIndex !== null || selectedCardIndex !== null)

  const playToZone = useCallback(
    async (cardIndex, zoneIndex) => {
      if (!onPlayCard || cardIndex == null) return
      setLocalError(null)
      try {
        const res = await onPlayCard(cardIndex, zoneIndex, 1)
        if (res?.error) setLocalError(res.error)
      } catch (e) {
        setLocalError(e?.message || 'Не удалось сыграть карту')
      } finally {
        setSelectedCardIndex(null)
        setDraggingIndex(null)
        setDragOverZone(null)
      }
    },
    [onPlayCard, setSelectedCardIndex]
  )

  const handleDragStart = (e, idx) => {
    if (!isYourTurn || isFinished) {
      e.preventDefault()
      return
    }
    setDraggingIndex(idx)
    setSelectedCardIndex(idx)
    try {
      e.dataTransfer.setData('text/plain', String(idx))
      e.dataTransfer.effectAllowed = 'move'
    } catch {}
  }

  const handleDragEnd = () => {
    setDraggingIndex(null)
    setDragOverZone(null)
  }

  const handleZoneDragOver = (e, zoneIdx) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverZone(zoneIdx)
  }

  const handleZoneDrop = (e, zoneIdx) => {
    e.preventDefault()
    e.stopPropagation()
    let idx = draggingIndex
    try {
      const raw = e.dataTransfer.getData('text/plain')
      if (raw !== '' && raw != null) idx = Number(raw)
    } catch {}
    if (idx == null || Number.isNaN(idx)) idx = selectedCardIndex
    if (idx == null) return
    playToZone(idx, zoneIdx)
  }

  const handleEndTurn = async (e) => {
    e.stopPropagation()
    e.preventDefault()
    setLocalError(null)
    if (typeof onEndTurn !== 'function') return
    try {
      const res = await onEndTurn()
      if (res?.error) setLocalError(res.error)
    } catch (err) {
      setLocalError(err?.message || 'Ошибка передачи хода')
    }
  }

  const errMsg = localError || actionError

  return (
    <>
      <button className="exit-btn" onClick={onGameEnd}>
        ← Выйти из игры
      </button>
      <button className="replay-open-btn" onClick={() => setReplayOpen(true)}>
        ⏮ Реплей ({Array.isArray(log) ? log.length : 0})
      </button>

      {isReplayOpen && <Replay log={log} onClose={() => setReplayOpen(false)} />}

      <div className="hud-opponent">
        Противник · ❤️ {safeOpp.health}/25 · 🂠 × {safeOpp.hand?.length || 0}
      </div>

      {(realtimeStatus === 'disconnected' || realtimeStatus === 'reconnecting') && (
        <div className="connection-banner">
          <span className="connection-spinner" />
          {realtimeStatus === 'disconnected'
            ? '⚠️ Связь потеряна — переподключаемся...'
            : '🔄 Переподключение к серверу...'}
        </div>
      )}

      {showDropZones && (
        <div className="hud-drop-zones" aria-label="Зоны для розыгрыша карты">
          {[0, 1, 2, 3].map((z) => (
            <div
              key={z}
              className={`hud-drop-zone${dragOverZone === z ? ' over' : ''}`}
              onDragOver={(e) => handleZoneDragOver(e, z)}
              onDragLeave={() => setDragOverZone(null)}
              onDrop={(e) => handleZoneDrop(e, z)}
              onClick={() => {
                if (selectedCardIndex != null) playToZone(selectedCardIndex, z)
              }}
            >
              <span className="hud-drop-zone-label">Земля {z + 1}</span>
              <span className="hud-drop-zone-hint">
                {draggingIndex !== null ? 'Отпустите карту' : 'Клик или drop'}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="hud-bottom">
        {errMsg && (
          <div className="hud-error" role="alert">
            ❌ {errMsg}
          </div>
        )}

        <div
          className={`hud-bottom-status ${isYourTurn ? 'your' : 'opponent'} ${isFinished ? 'finished' : ''}`}
        >
          {isFinished
            ? `🎉 ${winnerId === playerId ? 'Вы выиграли!' : 'Вы проиграли!'}`
            : isYourTurn
              ? '👉 Ваш ход'
              : '⏳ Ход противника'}
          <span className="hud-bottom-stats">
            ❤️ {safeMe.health}/25 · 📚 {safeMe.deck_pile?.length ?? safeMe.deck_remaining ?? 0}
          </span>
          {isYourTurn && !isFinished && (
            <div className="hud-bottom-buttons">
              <button type="button" className="hud-end-btn" onClick={handleEndTurn}>
                ⏭ Закончить ход
              </button>
              <button
                type="button"
                className="hud-forfeit-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  if (typeof onForfeit === 'function') onForfeit()
                }}
              >
                🏳️ Сдаться
              </button>
            </div>
          )}
        </div>

        <div className="hud-hand" role="list" aria-label="Ваша рука">
          {Array.isArray(handCards) && handCards.length > 0 ? (
            handCards.map((c, idx) => {
              const isSel = selectedCardIndex === idx
              const isDragging = draggingIndex === idx
              return (
                <button
                  type="button"
                  key={c?.id || c?.instanceId || idx}
                  className={`hud-hand-card${isSel ? ' selected' : ''}${isYourTurn ? '' : ' disabled'}${isDragging ? ' dragging' : ''}`}
                  disabled={!isYourTurn || isFinished}
                  draggable={isYourTurn && !isFinished}
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragEnd={handleDragEnd}
                  onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    setSelectedCardIndex(isSel ? null : idx)
                    setLocalError(null)
                  }}
                  aria-pressed={isSel}
                  title={c?.name ? `${c.name} — перетащите на землю` : `Карта ${idx + 1}`}
                >
                  <div className="hud-hand-card-cost">{c?.cost ?? '?'}</div>
                  <div className="hud-hand-card-name">{c?.name || `Карта ${idx + 1}`}</div>
                  {c?.attack !== undefined && (
                    <div className="hud-hand-card-attack">⚔ {c.attack}</div>
                  )}
                  {c?.health !== undefined && (
                    <div className="hud-hand-card-health">❤️ {c.health}</div>
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
        .hud-bottom {
          position: absolute; left: 0; right: 0; bottom: 0; z-index: 60;
          background: linear-gradient(180deg, rgba(10,10,30,0) 0%, rgba(10,10,30,0.92) 30%, rgba(10,10,30,0.98) 100%);
          padding: 14px 18px 18px 18px; font-family: 'Segoe UI', system-ui, sans-serif;
          color: white; pointer-events: auto;
        }
        .hud-error {
          background: rgba(244,67,54,0.92); color: white; padding: 8px 14px;
          border-radius: 8px; margin-bottom: 8px; font-weight: 700; font-size: 14px;
        }
        .hud-bottom-status {
          display: flex; align-items: center; gap: 14px; margin-bottom: 10px;
          flex-wrap: wrap; font-weight: 700; font-size: 16px;
        }
        .hud-bottom-status.your { color: #4caf50; }
        .hud-bottom-status.opponent { color: #ff9800; }
        .hud-bottom-status.finished { font-size: 22px; color: #ffd700; }
        .hud-bottom-stats { font-weight: 500; opacity: 0.85; font-size: 14px; margin-left: auto; }
        .hud-bottom-buttons { display: flex; gap: 10px; }
        .hud-end-btn, .hud-forfeit-btn {
          padding: 8px 18px; color: white; font-weight: 700; font-size: 14px;
          border-radius: 6px; cursor: pointer; border: none; pointer-events: auto; z-index: 61;
        }
        .hud-end-btn { background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%); }
        .hud-end-btn:hover { filter: brightness(1.15); }
        .hud-forfeit-btn { background: rgba(244, 67, 54, 0.85); border: 1px solid rgba(255,255,255,0.2); }
        .hud-forfeit-btn:hover { background: rgba(244, 67, 54, 1); }
        .hud-hand { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; pointer-events: auto; }
        .hud-hand-card {
          flex: 0 0 auto; min-width: 100px; max-width: 130px; height: 140px; padding: 8px;
          border-radius: 8px; background: linear-gradient(135deg, #2a3554 0%, #1f2940 100%);
          border: 2px solid rgba(255,255,255,0.2); color: white; cursor: grab;
          display: flex; flex-direction: column; gap: 4px; font-family: 'Segoe UI', system-ui, sans-serif;
          text-align: left; pointer-events: auto; position: relative; transition: all 0.15s ease;
        }
        .hud-hand-card:active { cursor: grabbing; }
        .hud-hand-card:hover { transform: translateY(-3px); border-color: rgba(255,255,255,0.5); }
        .hud-hand-card.selected { border-color: #4caf50; box-shadow: 0 0 16px rgba(76,175,80,0.6); transform: translateY(-4px); }
        .hud-hand-card.dragging { opacity: 0.55; transform: scale(0.95); }
        .hud-hand-card.disabled { opacity: 0.45; cursor: not-allowed; }
        .hud-hand-card-cost {
          position: absolute; top: 4px; left: 6px; width: 22px; height: 22px; background: #ff9800;
          color: #000; font-weight: 800; border-radius: 50%; display: flex; align-items: center;
          justify-content: center; font-size: 13px;
        }
        .hud-hand-card-name { font-size: 13px; font-weight: 700; margin-top: 24px; line-height: 1.15; max-height: 38px; overflow: hidden; }
        .hud-hand-card-attack { font-size: 12px; background: rgba(244,67,54,0.7); padding: 1px 6px; border-radius: 4px; align-self: flex-start; }
        .hud-hand-card-health { font-size: 12px; background: rgba(76,175,80,0.7); padding: 1px 6px; border-radius: 4px; align-self: flex-start; }
        .hud-hand-empty { color: rgba(255,255,255,0.5); font-style: italic; }
        .hud-drop-zones {
          position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%);
          display: flex; gap: 12px; z-index: 55; pointer-events: auto;
        }
        .hud-drop-zone {
          width: 110px; height: 130px; border-radius: 12px; border: 2px dashed rgba(76,175,80,0.7);
          background: rgba(20,40,30,0.75); display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 6px; color: #a5d6a7; cursor: pointer; transition: all 0.15s ease;
          backdrop-filter: blur(4px);
        }
        .hud-drop-zone.over, .hud-drop-zone:hover {
          border-color: #4caf50; background: rgba(46,125,50,0.55);
          box-shadow: 0 0 20px rgba(76,175,80,0.5); transform: scale(1.05); color: white;
        }
        .hud-drop-zone-label { font-weight: 800; font-size: 15px; }
        .hud-drop-zone-hint { font-size: 11px; opacity: 0.85; }
        .hud-opponent {
          position: absolute; top: 80px; left: 50%; transform: translateX(-50%);
          background: rgba(20,20,50,0.7); padding: 6px 14px; border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.15); color: rgba(255,255,255,0.85);
          font-size: 13px; font-family: 'Segoe UI', system-ui, sans-serif; z-index: 40;
        }
        .exit-btn {
          position: absolute; top: 12px; left: 12px; padding: 6px 14px; background: rgba(0,0,0,0.5);
          color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; cursor: pointer;
          z-index: 100; font-family: 'Segoe UI', system-ui, sans-serif;
        }
        .exit-btn:hover { background: rgba(0,0,0,0.8); }
        .replay-open-btn {
          position: absolute; top: 12px; left: 166px; padding: 6px 14px;
          background: rgba(59,130,246,0.72); color: white; border: 1px solid rgba(147,197,253,0.35);
          border-radius: 6px; cursor: pointer; z-index: 100; font-family: 'Segoe UI', system-ui, sans-serif;
        }
        .replay-open-btn:hover { background: rgba(59,130,246,0.95); }
        .connection-banner {
          position: absolute; top: 12px; left: 50%; transform: translateX(-50%); padding: 10px 18px;
          background: rgba(244,67,54,0.95); color: white; border-radius: 8px; font-weight: 700;
          font-family: 'Segoe UI', system-ui, sans-serif; font-size: 14px; box-shadow: 0 4px 16px rgba(0,0,0,0.5);
          z-index: 100; display: flex; align-items: center; gap: 8px;
          animation: connection-pulse 1.5s ease-in-out infinite;
        }
        .connection-spinner {
          display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.5);
          border-top-color: white; border-radius: 50%; animation: connection-spin 0.8s linear infinite;
        }
        @keyframes connection-spin { to { transform: rotate(360deg); } }
        @keyframes connection-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }
      `}</style>
    </>
  )
}
