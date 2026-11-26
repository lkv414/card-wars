import { useEffect } from 'react';
import type { PlayerView } from '@card-wars/protocol';
import { heroImageOf, heroNameOf } from './names';
import { downloadJournal } from './HudSidebar';
import { soundEngine } from '../../sound/SoundEngine';

/**
 * Orientation Shield for mobile phones held in portrait mode.
 * Reminds player to rotate to Landscape.
 */
export function OrientationGate() {
  return (
    <div className="diegetic-orientation-gate">
      <div className="gate-content">
        <div className="gate-icon">🔄</div>
        <h2>Поверните устройство!</h2>
        <p>Card Wars играется в альбомном режиме (Landscape) для лучшего обзора стола и карт.</p>
      </div>
    </div>
  );
}

function won(view: PlayerView): boolean {
  if (view.winners?.includes(view.me)) return true;
  const teamId = view.players[view.me]?.teamId;
  if (!teamId) return false;
  const team = view.teams?.[teamId];
  return Boolean(team && team.playerIds.some((pid) => view.winners?.includes(pid)));
}

/**
 * Triumphant Victory / Comedic Defeat Splash Screen (Stage 4.3).
 * Replaces the plain text overlay with Adventure Time / Ooo style rewards & celebration.
 */
export function MatchFinishOverlay({
  view,
  code,
}: {
  view: PlayerView;
  code: string;
}) {
  const me = view.players[view.me]!;
  const heroImage = heroImageOf(me.heroId);
  const heroName = heroNameOf(me.heroId);
  const hasWon = won(view);
  const isDraw = view.winners?.length === 0;

  useEffect(() => {
    if (hasWon) {
      soundEngine.playVictoryFanfare();
    } else if (!isDraw) {
      soundEngine.playDefeatSound();
    }
  }, [hasWon, isDraw]);

  const finishText =
    view.finishReason === 'surrender'
      ? 'Капитуляция соперника'
      : view.finishReason === 'disconnect'
        ? 'Обрыв соединения'
        : 'Жизни исчерпаны в честном бою';

  const mvpId = view.winners?.[0] ?? Object.keys(view.players)[0];
  const mvp = mvpId ? view.players[mvpId] : null;
  const mvpHeroName = mvp ? heroNameOf(mvp.heroId) : '';

  return (
    <div className="diegetic-finish-backdrop">
      <div className={`diegetic-finish-card cw-felt-box ${hasWon ? 'is-victory' : isDraw ? 'is-draw' : 'is-defeat'}`}>
        {/* Banner with icon */}
        <div className="finish-banner">
          <div className="finish-symbol">{hasWon ? '👑' : isDraw ? '🤝' : '🌧️'}</div>
          <h1 className="finish-title cw-ink-title">
            {hasWon ? 'ТРИУМФ И ПОБЕДА!' : isDraw ? 'НИЧЬЯ!' : 'ПОРАЖЕНИЕ...'}
          </h1>
          <p className="finish-subtitle">{finishText}</p>
        </div>

        {/* MVP Banner */}
        {mvp && (
          <div className="finish-mvp-banner">
            <span className="mvp-star">⭐</span>
            <span className="mvp-text">
              MVP матча: <b>{mvp.nickname}</b> ({mvpHeroName})
            </span>
          </div>
        )}

        {/* Hero Medallion */}
        <div className="finish-hero-medallion">
          {heroImage ? (
            <img src={heroImage} alt={heroName} className="finish-hero-img" />
          ) : (
            <span className="finish-hero-fallback">👑</span>
          )}
          <span className="finish-hero-name">{heroName}</span>
          <span className="finish-hero-hp">❤️ {me.lives} HP</span>
        </div>

        {/* 2v2 Teams summary */}
        {view.mode === 'teams' && view.teams && (
          <div className="finish-teams-summary">
            <span className="team-win-lbl">Победители:</span>
            <span className="team-win-names">
              {Object.values(view.teams)
                .filter((team) => team.playerIds.some((pid) => view.winners?.includes(pid)))
                .map((team) => team.playerIds.map((pid) => view.players[pid]?.nickname ?? pid).join(' и '))
                .join('; ') || '—'}
            </span>
          </div>
        )}

        {/* Round & turn stats */}
        <div className="finish-stats-row cw-paper-box">
          <div className="stat-pill">
            <span className="stat-label">Раундов:</span>
            <span className="stat-val">{view.round}</span>
          </div>
          <div className="stat-pill">
            <span className="stat-label">Всего ходов:</span>
            <span className="stat-val">{view.turn}</span>
          </div>
          <div className="stat-pill">
            <span className="stat-label">Событий в летописи:</span>
            <span className="stat-val">{view.journal.length}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="finish-actions">
          <button
            className="finish-rematch-btn cw-btn-3d btn-green"
            onClick={() => {
              soundEngine.playGong();
              location.href = `/play/${code}`;
            }}
            title="Сыграть реванш в этой комнате"
          >
            ⚔️ Реванш
          </button>
          <button
            className="finish-journal-btn cw-btn-3d btn-gold"
            onClick={downloadJournal(view.journal, code)}
            title="Скачать сургучную летопись матча"
          >
            📜 Сургучная печать (.txt)
          </button>
          <button
            className="finish-menu-btn cw-btn-3d btn-blue"
            onClick={() => {
              soundEngine.playButtonClick();
              location.href = '/';
            }}
          >
            🏰 В главное меню
          </button>
        </div>
      </div>
    </div>
  );
}
