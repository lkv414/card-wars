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
}) {
  const [isReplayOpen, setReplayOpen] = useState(false)

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

      {/* Центральный HUD */}
      <div className="hud-center">
        {isFinished ? (
          <div className="hud-finished">
            🎉 {winnerId === playerId ? 'Вы выиграли!' : 'Вы проиграли!'}
          </div>
        ) : (
          <div className={`hud-turn ${isYourTurn ? 'your' : 'opponent'}`}>
            {isYourTurn ? '👉 Ваш ход' : '⏳ Ход противника'}
            <div className="hud-stats">
              ❤️ Вы {me.health}/25 · 🤚 Рука {handCards.length} · 📚 Колода {me.deck_remaining}
            </div>
            {isYourTurn && (
              <div className="hud-actions">
                <button className="hud-end-btn" onClick={onEndTurn}>Закончить ход</button>
                <button
                  className="hud-forfeit-btn"
                  onClick={onForfeit}
                  title="Сдаться — оппонент победит"
                >
                  🏳️ Сдаться
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* HUD противника */}
      <div className="hud-opponent">
        Противник · ❤️ {opp.health}/25 · 🂠 × {opp.hand?.length || 0}
      </div>

      {/* Баннер разрыва связи */}
      {(realtimeStatus === 'disconnected' || realtimeStatus === 'reconnecting') && (
        <div className="connection-banner">
          <span className="connection-spinner" />
          {realtimeStatus === 'disconnected'
            ? '⚠️ Связь потеряна — переподключаемся...'
            : '🔄 Переподключение к серверу...'}
        </div>
      )}

      <style>{`
        .hud-center {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 50;
          pointer-events: none;
        }
        .hud-center .hud-finished {
          font-size: 28px;
          font-weight: 700;
          color: white;
          background: rgba(20, 20, 50, 0.9);
          padding: 20px 28px;
          border-radius: 12px;
          border: 2px solid #4caf50;
          text-align: center;
          pointer-events: auto;
        }
        .hud-turn {
          background: rgba(20, 20, 50, 0.85);
          padding: 12px 18px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          backdrop-filter: blur(8px);
          color: white;
          text-align: center;
          min-width: 240px;
          font-family: 'Segoe UI', system-ui, sans-serif;
          box-shadow: 0 4px 24px rgba(0,0,0,0.4);
          pointer-events: auto;
        }
        .hud-turn.your { color: #4caf50; }
        .hud-turn.opponent { color: #ff9800; }
        .hud-stats { margin-top: 6px; font-size: 13px; opacity: 0.85; color: white; }
        .hud-actions { display: flex; gap: 8px; margin-top: 8px; justify-content: center; }
        .hud-end-btn {
          padding: 6px 14px;
          background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%);
          border: none;
          border-radius: 6px;
          color: white;
          font-weight: 700;
          cursor: pointer;
        }
        .hud-forfeit-btn {
          padding: 6px 14px;
          background: rgba(244, 67, 54, 0.85);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 6px;
          color: white;
          font-weight: 700;
          cursor: pointer;
        }
        .hud-forfeit-btn:hover { background: rgba(244, 67, 54, 1); }
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
        @keyframes connection-spin { to { transform: rotate(360deg); } }
        @keyframes connection-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }
      `}</style>
    </>
  )
}
