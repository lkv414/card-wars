import { useEffect, useRef, useState } from 'react';
import type { PlayerView } from '@card-wars/protocol';
import {
  emitEmote,
  sendCommand,
  setQuality,
  snapCameraPlayer,
  useGame,
} from '../../store';
import { heroImageOf, heroNameOf } from './names';
import { soundEngine } from '../../sound/SoundEngine';

export function downloadJournal(journal: string[], code: string): () => void {
  return () => {
    const blob = new Blob([journal.join('\r\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `card-wars-${code}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };
}

export const EMOTE_LINES = [
  { id: 'floop', label: '«Флюпни это!»', text: 'Флюпни это!', emoji: '🌀' },
  { id: 'good_move', label: '«Хороший ход!»', text: 'Хороший ход!', emoji: '👍' },
  { id: 'invincible', label: '«Я непобедим!»', text: 'Я непобедим!', emoji: '👑' },
  { id: 'oops', label: '«Ой...»', text: 'Ой...', emoji: '🤦‍♂️' },
  { id: 'thinking', label: '«Дай подумать...»', text: 'Дай подумать...', emoji: '🤔' },
  { id: 'surrender', label: '«Сдавайся!»', text: 'Сдавайся!', emoji: '⚔️' },
  { id: 'pancakes', label: '«Блин блинский!»', text: 'Блин блинский!', emoji: '🥞' },
  { id: 'dice', label: '🎲 Бросить кубик', text: 'бросает кубик', emoji: '🎲' },
];

/**
 * Combat Gong / Big Turn Button in the bottom-right corner (Hearthstone / Adventure Time style).
 * Integrates the turn action ("В БОЙ!"), hurry-up for opponents, and circular turn timer.
 */
export function CombatGongBtn({
  view,
  isHurryPulsing,
  onHurryPulse,
}: {
  view: PlayerView;
  isHurryPulsing: boolean;
  onHurryPulse: () => void;
}) {
  const timer = useGame((s) => s.timer);
  const me = view.players[view.me]!;
  const myTurn = view.activePlayers.includes(view.me) && view.status === 'running';
  const myMain = myTurn && view.phase === 'main';

  const myTeam = me.teamId ? view.teams?.[me.teamId] ?? null : null;
  const is2v2 = view.mode === 'teams' && Boolean(myTeam);
  const teammateId = is2v2 ? myTeam?.playerIds.find((id) => id !== view.me) : null;
  const teammate = teammateId ? view.players[teammateId] : null;

  const activeOpponentId = view.activePlayers.find((pid) => pid !== view.me);
  const activeOpponent = activeOpponentId ? view.players[activeOpponentId] : null;

  const [now, setNow] = useState(Date.now());
  const anchor = useRef({ remainingMs: timer?.remainingMs ?? 0, at: Date.now() });

  useEffect(() => {
    if (timer?.remainingMs !== undefined) {
      anchor.current = { remainingMs: timer.remainingMs, at: Date.now() };
      setNow(Date.now());
    }
  }, [timer?.remainingMs]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const left = Math.max(0, anchor.current.remainingMs - (now - anchor.current.at));
  const seconds = Math.ceil(left / 1000);
  const timerLow = left < 15_000;

  const lastSecondTickedRef = useRef(-1);
  useEffect(() => {
    if (timerLow && seconds > 0 && seconds <= 15 && lastSecondTickedRef.current !== seconds) {
      lastSecondTickedRef.current = seconds;
      soundEngine.playFuseTick(seconds <= 5);
    }
  }, [timerLow, seconds]);

  const handleActionClick = () => {
    if (myMain) {
      soundEngine.playGong();
      sendCommand({ type: 'go_battle', player: view.me });
    } else if (!myTurn && activeOpponentId) {
      soundEngine.playFuseTick(true);
      onHurryPulse();
      useGame.getState().hurry(activeOpponentId);
    }
  };

  return (
    <div className="diegetic-gong-container">
      {/* Таймер фитиля */}
      {timer && timer.remainingMs > 0 && (
        <div className={`diegetic-timer-badge ${timerLow ? 'low-fuse' : ''} ${isHurryPulsing ? 'hurry-pulse' : ''}`}>
          <span className="fuse-icon">{timerLow ? '🔥' : '⏳'}</span>
          <span className="fuse-time">
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
          </span>
        </div>
      )}

      {/* Главная кнопка-гонг */}
      <button
        className={`diegetic-gong-btn cw-btn-3d ${myMain ? 'btn-red my-turn-cta' : 'btn-dark opponent-turn'} ${
          isHurryPulsing ? 'hurry-pulse' : ''
        }`}
        onClick={handleActionClick}
        disabled={myTurn && (!myMain || me.battleReady)}
        title={
          myMain
            ? 'Перейти в фазу боя (Space / клик)'
            : !myTurn
            ? `Поторопить игрока ${activeOpponent?.nickname ?? ''}`
            : 'Ожидание...'
        }
      >
        <span className="gong-inner">
          <span className="gong-icon">{myMain ? '⚔️' : !myTurn ? '⚡' : '🛡️'}</span>
          <span className="gong-title">
            {myMain
              ? is2v2 && !me.battleReady
                ? 'ГОТОВ К БОЮ'
                : 'В БОЙ!'
              : !myTurn
              ? `Ход: ${activeOpponent?.nickname ?? 'врага'}`
              : me.battleReady
              ? 'ОЖИДАНИЕ...'
              : 'БОЙ...'}
          </span>
          {!myTurn && <span className="gong-sub">Поторопить ⚡</span>}
          {is2v2 && myMain && (
            <span className="gong-sub">
              Команда: {(me.battleReady ? 1 : 0) + (teammate?.battleReady ? 1 : 0)}/2
            </span>
          )}
        </span>
      </button>
    </div>
  );
}

/**
 * Hero Portrait & Vitals Widget in the bottom-left corner.
 * Shows player hero portrait, heart life crystals, action mana lightning bolts, and emotes bubble.
 */
export function HeroPortraitWidget({ view }: { view: PlayerView }) {
  const me = view.players[view.me]!;
  const heroImage = heroImageOf(me.heroId);
  const heroName = heroNameOf(me.heroId);
  const [emotesOpen, setEmotesOpen] = useState(false);

  return (
    <div className="diegetic-hero-widget bottom-left">
      {/* Жетоны действий: тактильные круглые монеты с золотой/оранжевой сердцевиной (docs/AUDIT-KIBERBUS-UIUX.md §1, §8 Этап 2) */}
      <div className="diegetic-actions-coins" title={`Действий: ${me.actions}`} aria-label={`Действий: ${me.actions}`}>
        {Array.from({ length: Math.max(2, me.actions) }).map((_, i) => {
          const isActive = i < me.actions;
          return (
            <div
              key={i}
              className={`cw-coin-token ${isActive ? 'coin-active' : 'coin-spent'}`}
              title={isActive ? 'Очко действия доступно' : 'Очко действия потрачено'}
            >
              <div className="coin-rim">
                <div className="coin-core">⚡</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Медальон героя */}
      <div
        className="diegetic-portrait-frame"
        onClick={() => {
          soundEngine.playEmoteChirp();
          setEmotesOpen(!emotesOpen);
        }}
        title="Клик: открыть реплики и эмоции"
      >
        {heroImage ? (
          <img src={heroImage} alt={heroName} className="hero-avatar-img" />
        ) : (
          <div className="hero-avatar-placeholder">👑</div>
        )}
        <div className="hero-level-crown">⭐</div>

        {/* Сердечко жизней */}
        <div className={`diegetic-heart-badge ${me.lives < 10 ? 'critical' : ''}`}>
          <span className="heart-icon">❤️</span>
          <span className="heart-value">{me.lives}</span>
        </div>
      </div>

      {/* Имя и герой */}
      <div className="diegetic-nameplate">
        <span className="player-nick">{me.nickname}</span>
        <span className="hero-title">{heroName}</span>
      </div>

      {/* Всплывающее колесо реплик и эмоций */}
      {emotesOpen && (
        <div className="diegetic-emotes-bubble">
          <div className="emotes-bubble-header">
            <span>Реплики {heroName}</span>
            <button
              className="bubble-close"
              onClick={() => {
                soundEngine.playButtonClick();
                setEmotesOpen(false);
              }}
            >
              ✕
            </button>
          </div>
          <div className="emotes-bubble-grid">
            {EMOTE_LINES.map((emote) => (
              <button
                key={emote.id}
                className="emote-bubble-btn"
                onClick={() => {
                  soundEngine.playEmoteChirp();
                  if (emote.id === 'dice') {
                    const roll = Math.floor(Math.random() * 6) + 1;
                    emitEmote(me.nickname, `выбросил на кубике: 🎲 ${roll}`);
                  } else {
                    emitEmote(me.nickname, emote.text, emote.emoji);
                  }
                  setEmotesOpen(false);
                }}
              >
                <span className="btn-emoji">{emote.emoji}</span>
                <span className="btn-txt">{emote.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Opponents Roster in the top-left corner.
 * Shows compact hero portraits of opponents with their lives, names, and turn highlights.
 */
export function OpponentsRosterWidget({ view }: { view: PlayerView }) {
  const opponents = view.order
    .filter((pid) => pid !== view.me)
    .map((pid) => view.players[pid])
    .filter(Boolean);

  return (
    <div className="diegetic-opponents-roster top-left">
      {opponents.map((opp) => {
        if (!opp) return null;
        const isActive = view.activePlayers.includes(opp.id);
        const heroImg = heroImageOf(opp.heroId);
        const heroName = heroNameOf(opp.heroId);

        return (
          <div
            key={opp.id}
            className={`opponent-chip ${isActive ? 'active-turn' : ''} ${
              opp.eliminated ? 'eliminated' : ''
            }`}
            onClick={() => snapCameraPlayer(opp.id)}
            title={`Переключить камеру на ${opp.nickname} (${heroName})`}
          >
            <div className="opp-avatar-frame">
              {heroImg ? (
                <img src={heroImg} alt={opp.nickname} className="opp-img" />
              ) : (
                <div className="opp-placeholder">👤</div>
              )}
              {isActive && <div className="opp-active-ring" />}
            </div>
            <div className="opp-meta">
              <span className="opp-nick">{opp.nickname}</span>
              <span className="opp-hp">❤️ {opp.lives}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Slide-out Parchment Journal Drawer.
 * Slides out smoothly from the left edge when the player clicks the floating scroll icon.
 */
export function JournalDrawerWidget({
  journal,
  code,
  unreadCount,
  isOpen,
  onToggle,
}: {
  journal: string[];
  code: string;
  unreadCount: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      {/* Floating Parchment Scroll Button */}
      <button
        className={`diegetic-journal-btn ${isOpen ? 'open' : ''}`}
        onClick={() => {
          soundEngine.playButtonClick();
          onToggle();
        }}
        title="Журнал боя (хронология партии)"
      >
        <span className="scroll-icon">📜</span>
        {unreadCount > 0 && <span className="unread-counter">{unreadCount}</span>}
      </button>

      {/* Slide-out Parchment Drawer */}
      {isOpen && (
        <div className="diegetic-journal-drawer">
          <div className="drawer-header">
            <span className="drawer-title">📜 Летопись боя</span>
            <div className="drawer-actions">
              <button
                className="drawer-dl-btn"
                onClick={downloadJournal(journal, code)}
                title="Скачать историю матча в .txt"
              >
                💾 .txt
              </button>
              <button
                className="drawer-close-btn"
                onClick={() => {
                  soundEngine.playButtonClick();
                  onToggle();
                }}
              >
                ✕
              </button>
            </div>
          </div>

          <div className="drawer-scrollable-log">
            {journal.length === 0 ? (
              <div className="log-empty">Бой только начался...</div>
            ) : (
              journal.map((entry, i) => (
                <div key={i} className="log-entry">
                  {entry}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Settings & Pause Modal in the top-right corner.
 */
export function SettingsMenuWidget({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const quality = useGame((s) => s.ui.quality);
  const view = useGame((s) => s.view);
  const [audioSettings, setAudioSettings] = useState(() => soundEngine.getSettings());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        soundEngine.playButtonClick();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleMuteToggle = () => {
    const nextMuted = !audioSettings.muted;
    soundEngine.setMuted(nextMuted);
    setAudioSettings(soundEngine.getSettings());
    if (!nextMuted) soundEngine.playButtonClick();
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    soundEngine.setVolume(vol);
    setAudioSettings(soundEngine.getSettings());
  };

  const handleShakeToggle = () => {
    const next = !audioSettings.shakeEnabled;
    soundEngine.setShakeEnabled(next);
    setAudioSettings(soundEngine.getSettings());
    soundEngine.playButtonClick();
  };

  return (
    <div className="diegetic-settings-widget top-right">
      <button
        className="diegetic-gear-btn"
        onClick={() => {
          soundEngine.playButtonClick();
          setOpen(!open);
        }}
        title="Настройки матча (Esc)"
      >
        ⚙️
      </button>

      {open && (
        <div
          className="diegetic-modal-backdrop"
          onClick={() => {
            soundEngine.playButtonClick();
            setOpen(false);
          }}
        >
          <div className="diegetic-settings-card" onClick={(e) => e.stopPropagation()}>
            <div className="card-header">
              <h3>Настройки матча</h3>
              <button
                className="card-close"
                onClick={() => {
                  soundEngine.playButtonClick();
                  setOpen(false);
                }}
              >
                ✕
              </button>
            </div>

            <div className="card-section">
              <span className="section-title">Комната:</span>
              <span className="room-code-tag">#{code}</span>
            </div>

            {/* Звуковой движок (Stage 2) */}
            <div className="card-section audio-controls">
              <span className="section-title">Звуковые эффекты (SFX):</span>
              <div className="diegetic-audio-row">
                <button
                  className={`audio-toggle-btn ${audioSettings.muted ? 'muted' : 'active'}`}
                  onClick={handleMuteToggle}
                >
                  {audioSettings.muted ? '🔇 Без звука' : '🔊 Звук вкл'}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={audioSettings.muted ? 0 : audioSettings.volume}
                  onChange={handleVolumeChange}
                  className="diegetic-volume-slider"
                  disabled={audioSettings.muted}
                  title="Громкость эффектов"
                />
                <span className="volume-pct">
                  {audioSettings.muted ? '0%' : `${Math.round(audioSettings.volume * 100)}%`}
                </span>
              </div>
            </div>

            {/* Сотрясение камеры при ударах (Screen Shake) */}
            <div className="card-section">
              <span className="section-title">Сотрясение стола (Juice):</span>
              <button
                className={`shake-toggle-btn ${audioSettings.shakeEnabled ? 'enabled' : 'disabled'}`}
                onClick={handleShakeToggle}
              >
                {audioSettings.shakeEnabled ? '📳 Тряска камеры: Вкл' : '📴 Тряска камеры: Выкл'}
              </button>
            </div>

            {/* Атмосферная музыка (Укулеле) */}
            <div className="card-section">
              <span className="section-title">Атмосферная музыка (Укулеле):</span>
              <button
                className={`shake-toggle-btn ${audioSettings.musicEnabled ? 'enabled' : 'disabled'}`}
                onClick={() => {
                  const next = soundEngine.toggleMusic();
                  setAudioSettings((s) => ({ ...s, musicEnabled: next }));
                }}
              >
                {audioSettings.musicEnabled ? '🎵 Музыка: Вкл' : '🔇 Музыка: Выкл'}
              </button>
            </div>

            <div className="card-section">
              <span className="section-title">Качество графики:</span>
              <button
                className="quality-toggle-btn"
                onClick={() => {
                  soundEngine.playButtonClick();
                  setQuality(quality === 'high' ? 'low' : 'high');
                }}
              >
                {quality === 'high' ? 'HD (тени и сглаживание)' : 'SD (производительность)'}
              </button>
            </div>

            <div className="card-section hotkeys-ref">
              <span className="section-title">Горячие клавиши:</span>
              <div className="hotkeys-list">
                <div><kbd>Space</kbd> — Камера «К себе»</div>
                <div><kbd>H</kbd> — Свернуть / показать руку</div>
                <div><kbd>V</kbd> — Следить за ходом</div>
                <div><kbd>ПКМ / Колесо</kbd> — Свободный осмотр</div>
              </div>
            </div>

            {view && view.status === 'running' && (
              <div className="card-footer">
                <button
                  className="surrender-btn"
                  onClick={() => {
                    if (confirm('Сдаться и признать поражение?')) {
                      sendCommand({ type: 'surrender', player: view.me });
                      setOpen(false);
                    }
                  }}
                >
                  🏳️ Сдаться
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

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
      <div className={`diegetic-finish-card ${hasWon ? 'is-victory' : isDraw ? 'is-draw' : 'is-defeat'}`}>
        {/* Banner with icon */}
        <div className="finish-banner">
          <div className="finish-symbol">{hasWon ? '👑' : isDraw ? '🤝' : '🌧️'}</div>
          <h1 className="finish-title">
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
        <div className="finish-stats-row">
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
            className="finish-rematch-btn"
            onClick={() => {
              soundEngine.playGong();
              location.href = `/play/${code}`;
            }}
            title="Сыграть реванш в этой комнате"
          >
            ⚔️ Реванш
          </button>
          <button
            className="finish-journal-btn"
            onClick={downloadJournal(view.journal, code)}
            title="Скачать сургучную летопись матча"
          >
            📜 Сургучная печать (.txt)
          </button>
          <button
            className="finish-menu-btn"
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
