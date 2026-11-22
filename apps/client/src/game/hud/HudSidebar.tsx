import { useCallback, useEffect, useRef, useState } from 'react';
import { CONFIG, type PlayerView } from '@card-wars/protocol';
import {
  cycleCameraPlayer,
  emitEmote,
  sendCommand,
  setCameraSnap,
  setQuality,
  setUi,
  showHint,
  snapCameraPlayer,
  snapCameraTop,
  useGame,
} from '../../store';
import { heroNameOf } from './names';

const EMOTE_LINES = [
  { id: 'floop', label: '«Флюпни это!»', text: 'Флюпни это!', emoji: '🌀' },
  { id: 'good_move', label: '«Хороший ход!»', text: 'Хороший ход!', emoji: '👍' },
  { id: 'invincible', label: '«Я непобедим!»', text: 'Я непобедим!', emoji: '👑' },
  { id: 'oops', label: '«Ой...»', text: 'Ой...', emoji: '🤦‍♂️' },
  { id: 'thinking', label: '«Дай подумать...»', text: 'Дай подумать...', emoji: '🤔' },
  { id: 'surrender', label: '«Сдавайся!»', text: 'Сдавайся!', emoji: '⚔️' },
  { id: 'pancakes', label: '«Блин блинский!»', text: 'Блин блинский!', emoji: '🥞' },
  { id: 'dice', label: '🎲 Бросить кубик', text: 'бросает кубик', emoji: '🎲' },
];

export interface HudSidebarProps {
  code: string;
  view: PlayerView;
  unreadCount: number;
  journalOpen: boolean;
  onToggleJournal: () => void;
  isHurryPulsing: boolean;
  onHurryPulse: () => void;
}

function phaseRu(phase: string): string {
  return phase === 'main' ? 'Основная' : phase === 'combat' ? 'Бой' : 'Добор';
}

function TimerBadge({ remainingMs, isPulsing }: { remainingMs: number; isPulsing?: boolean }) {
  const [now, setNow] = useState(Date.now());
  const anchor = useRef({ remainingMs, at: Date.now() });
  useEffect(() => {
    anchor.current = { remainingMs, at: Date.now() };
    setNow(Date.now());
  }, [remainingMs]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, anchor.current.remainingMs - (now - anchor.current.at));
  const seconds = Math.ceil(left / 1000);
  return (
    <span className={`hud-timer-badge ${left < 15_000 ? 'low' : ''} ${isPulsing ? 'timer-hurry-pulse' : ''}`}>
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </span>
  );
}

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

/**
 * Dedicated right-hand action sidebar (Split-Screen layout):
 * Consolidates all game HUD elements (room info, player status, roster, turn actions, camera snaps, history, emotes)
 * so that the 3D game arena remains 100% clean and unobstructed.
 */
export function HudSidebar({
  code,
  view,
  unreadCount,
  journalOpen,
  onToggleJournal,
  isHurryPulsing,
  onHurryPulse,
}: HudSidebarProps) {
  const quality = useGame((s) => s.ui.quality);
  const cameraMode = useGame((s) => s.ui.cameraMode);
  const cameraSnap = useGame((s) => s.ui.cameraSnap);
  const timer = useGame((s) => s.timer);

  const me = view.players[view.me]!;
  const myTurn = view.activePlayers.includes(view.me) && view.status === 'running';
  const myMain = myTurn && view.phase === 'main';

  const myTeam = me.teamId ? view.teams?.[me.teamId] ?? null : null;
  const is2v2 = view.mode === 'teams' && Boolean(myTeam);
  const teammateId = is2v2 ? myTeam?.playerIds.find((id) => id !== view.me) : null;
  const teammate = teammateId ? view.players[teammateId] : null;
  const teamReadyCount = (me.battleReady ? 1 : 0) + (teammate?.battleReady ? 1 : 0);

  const [desktopCollapsed, setDesktopCollapsed] = useState(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem('cw-sidebar-collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [emotesOpen, setEmotesOpen] = useState(false);
  const [surrenderModalOpen, setSurrenderModalOpen] = useState(false);

  const toggleDesktopCollapse = () => {
    setDesktopCollapsed((prev) => {
      const next = !prev;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('cw-sidebar-collapsed', next ? '1' : '0');
        }
      } catch {}
      return next;
    });
  };

  // Auto-open sidebar on match start mulligan if user had it collapsed
  useEffect(() => {
    if (view.status === 'mulligan' && desktopCollapsed) {
      setDesktopCollapsed(false);
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('cw-sidebar-collapsed', '0');
        }
      } catch {}
    }
  }, [view.status, desktopCollapsed]);

  // Keyboard accessibility: Escape closes open menus/modals
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (surrenderModalOpen) {
          setSurrenderModalOpen(false);
          return;
        }
        if (emotesOpen) {
          setEmotesOpen(false);
          return;
        }
        if (mobileDrawerOpen) {
          setMobileDrawerOpen(false);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [surrenderModalOpen, emotesOpen, mobileDrawerOpen]);

  const handleCycleOpponents = useCallback(() => {
    const aliveOpponents = view.order.filter(
      (id) => id !== view.me && !view.players[id]?.eliminated,
    );
    if (aliveOpponents.length === 0) return;
    const currentSnap = useGame.getState().ui.cameraSnap;
    if (currentSnap && currentSnap.startsWith('player_')) {
      cycleCameraPlayer('next');
    } else {
      snapCameraPlayer(aliveOpponents[0]);
    }
  }, [view.order, view.me, view.players]);

  const handleEmoteSelect = (item: (typeof EMOTE_LINES)[number]) => {
    if (item.id === 'dice') {
      const roll = Math.floor(Math.random() * 6) + 1;
      emitEmote(me.nickname, `выбросил ${roll} на кубике!`, '🎲');
      showHint(`${me.nickname} выбросил ${roll} на кубике 🎲`);
    } else {
      emitEmote(me.nickname, item.text, item.emoji);
      showHint(`${me.nickname}: «${item.text}» ${item.emoji}`);
    }
    setEmotesOpen(false);
  };

  const battleBtnDisabled =
    !myMain || (is2v2 && me.battleReady) || view.status !== 'running';

  const battleBtnText = (() => {
    if (view.status === 'finished') return '🏁 Окончено';
    if (view.status === 'mulligan') return '🎴 Муллиган';
    if (view.phase === 'combat') return '⚔️ Фаза боя';
    if (!myTurn) {
      const activeNick = view.activePlayers.map((id) => view.players[id]?.nickname ?? id).join(', ');
      return activeNick ? `⏳ Ход: ${activeNick}` : 'Ожидание';
    }
    if (is2v2) {
      return me.battleReady ? '✓ Готов' : 'В бой (готов)';
    }
    return 'В бой';
  })();

  const phaseLabel = phaseRu(view.phase);
  const actionsSpent = myMain && me.actions === 0 && (!is2v2 || !me.battleReady);

  return (
    <>
      {/* Mobile Floating Bottom Bar for quick combat & drawer toggle */}
      <div className="hud-mobile-bottom-bar" role="toolbar" aria-label="Быстрые действия">
        <button
          className={`hud-mobile-btn-battle ${myMain && (!is2v2 || !me.battleReady) ? 'pulse' : ''} ${
            actionsSpent ? 'actions-spent' : ''
          }`}
          disabled={battleBtnDisabled}
          onClick={() => sendCommand({ type: 'go_battle', player: view.me })}
          onTouchStart={() => setUi({ combatForecastHover: true })}
          onTouchEnd={() => setUi({ combatForecastHover: false })}
          aria-label={battleBtnText}
        >
          <span className="btn-icon">⚔️</span>
          <span className="btn-text">{battleBtnText}</span>
        </button>

        <button
          className={`hud-mobile-btn-menu ${unreadCount > 0 ? 'has-badge' : ''}`}
          onClick={() => setMobileDrawerOpen(true)}
          aria-label="Открыть панель действий"
        >
          <span className="btn-icon">⚡</span>
          <span className="btn-label">Панель</span>
          {unreadCount > 0 && <span className="mobile-badge">{unreadCount}</span>}
        </button>
      </div>

      {/* Mobile slide-over backdrop */}
      {mobileDrawerOpen && (
        <div
          className="hud-sidebar-backdrop"
          onClick={() => setMobileDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Dedicated Right Action Sidebar */}
      <aside
        className={`game-sidebar hud-sidebar ${desktopCollapsed ? 'collapsed' : ''} ${
          mobileDrawerOpen ? 'mobile-open' : ''
        }`}
        aria-label="Панель действий матча"
      >
        {/* Floating edge tab so collapsed sidebar can always be expanded with 1 click */}
        {desktopCollapsed && (
          <button
            className="hud-sidebar-floating-tab"
            onClick={toggleDesktopCollapse}
            title="Развернуть панель действий (◀)"
            aria-label="Развернуть панель действий"
          >
            ◀
          </button>
        )}

        {/* Header: Room Code, Round/Turn, Quality HD/SD, Collapse Button */}
        <div className="hud-sidebar-header">
          {desktopCollapsed ? (
            <div className="hud-sidebar-collapsed-head">
              <button
                className="hud-sidebar-toggle-btn is-expand-btn"
                onClick={toggleDesktopCollapse}
                title="Развернуть панель (◀)"
                aria-label="Развернуть панель"
              >
                ◀
              </button>
            </div>
          ) : (
            <>
              <div className="hud-sidebar-header-top">
                <span className="hud-room-code" title={`Комната ${code}`}>
                  🏠 {code}
                </span>
                <div className="hud-header-actions">
                  <button
                    className="hud-quality-toggle mini"
                    onClick={() => setQuality(quality === 'high' ? 'low' : 'high')}
                    title={`Качество графики: ${quality === 'high' ? 'высокое (HD)' : 'низкое (SD)'}`}
                    aria-label={`Качество: ${quality === 'high' ? 'HD' : 'SD'}`}
                  >
                    {quality === 'high' ? 'HD' : 'SD'}
                  </button>
                  <button
                    className="hud-sidebar-toggle-btn"
                    onClick={toggleDesktopCollapse}
                    title="Свернуть панель (▶)"
                    aria-label="Свернуть панель"
                  >
                    ▶
                  </button>
                  <button
                    className="hud-sidebar-mobile-close"
                    onClick={() => setMobileDrawerOpen(false)}
                    aria-label="Закрыть панель"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="hud-sidebar-meta">
                <span className="hud-sidebar-title">
                  {view.status === 'running' ? `Круг ${view.round} · Ход ${view.turn}` : 'Матч'}
                </span>
                <span className={`hud-sidebar-phase-badge phase-${view.phase}`}>
                  {phaseLabel}
                </span>
              </div>
            </>
          )}
        </div>

        <div className="hud-sidebar-scroll">
          {/* Section: Mulligan Decision in Right Sidebar */}
          {view.status === 'mulligan' && (
            <div className="hud-sidebar-section mulligan-section">
              <div className="section-label">
                <span>🎴 Стартовая рука</span>
              </div>
              <div className="hud-mulligan-card">
                <p className="hud-mulligan-hint">
                  {me.mulliganDecision
                    ? 'Решение принято! Ждём остальных игроков...'
                    : 'Оставить текущую руку или один раз перемешать и взять 5 новых?'}
                </p>
                <div className="hud-mulligan-actions">
                  <button
                    className="hud-mulligan-btn hud-mulligan-keep"
                    disabled={me.mulliganDecision !== null}
                    onClick={() => sendCommand({ type: 'keep_hand', player: view.me })}
                    title="Оставить текущие 5 карт в руке"
                  >
                    <span className="btn-icon">✓</span>
                    <span className="btn-label">Оставить</span>
                  </button>
                  <button
                    className="hud-mulligan-btn hud-mulligan-redraw"
                    disabled={me.mulliganDecision !== null}
                    onClick={() => sendCommand({ type: 'mulligan', player: view.me })}
                    title="Сбросить карты, перемешать колоду и взять 5 новых (один раз за матч)"
                  >
                    <span className="btn-icon">🔄</span>
                    <span className="btn-label">Перемешать</span>
                  </button>
                </div>
                {me.mulliganDecision && (
                  <div className="hud-mulligan-chosen-badge">
                    Вы выбрали: <b>{me.mulliganDecision === 'keep' ? 'Оставить' : 'Перемешать'}</b>
                  </div>
                )}
              </div>
            </div>
          )}
          {/* Section 0: My Status (Lives, Actions, Hand) */}
          <div className="hud-sidebar-section status-section">
            <div className="hud-status-card">
              <div className="hud-status-header">
                <span className="status-hero">{heroNameOf(me.heroId)}</span>
                <span className="status-nick">{me.nickname} (вы)</span>
              </div>
              <div className="hud-status-metrics">
                <div className="metric-pill metric-lives" title="Жизни">
                  <span className="metric-icon">❤</span>
                  <span className="metric-val">{me.lives}</span>
                  {me.maxLives !== CONFIG.startingLives && (
                    <span className="metric-sub">/{me.maxLives}</span>
                  )}
                </div>
                <div className="metric-pill metric-actions" title={`Оставшиеся действия: ${me.actions}`}>
                  <span className="metric-icon">⚡</span>
                  <span className="metric-val">{me.actions}</span>
                  <div className="metric-pips" aria-hidden="true">
                    {Array.from({ length: Math.max(CONFIG.actionsPerTurn, me.actions) }).map((_, i) => (
                      <span
                        key={i}
                        className={`pip-dot ${i < me.actions ? 'pip-active' : 'pip-spent'}`}
                      />
                    ))}
                  </div>
                </div>
                <div className="metric-pill metric-hand" title="Карт в руке">
                  <span className="metric-icon">🎴</span>
                  <span className="metric-val">{me.handCount}</span>
                </div>
              </div>
              {myTeam && (
                <div className="hud-team-status">
                  <span className="hint">Команда {myTeam.id === 'team-a' ? 'A' : 'B'}:</span>
                  <span className="team-lives">❤ {myTeam.lives}/{myTeam.maxLives}</span>
                </div>
              )}
            </div>
          </div>

          {/* Section 1: Players Roster with Camera Click */}
          <div className="hud-sidebar-section players-section">
            <div className="section-label">
              <span>👥 Игроки ({view.order.length})</span>
            </div>
            <div className="hud-players-list" role="list">
              {view.order.map((pid) => {
                const p = view.players[pid]!;
                const isCurrentMe = pid === view.me;
                const isActive = view.activePlayers.includes(pid);
                const isFocused =
                  cameraSnap === `player_${pid}` ||
                  cameraSnap === `top_${pid}` ||
                  (isCurrentMe && (cameraSnap === 'self' || cameraSnap === 'top' || !cameraSnap));
                const playerTimer = timer?.timers.find((t) => t.player === pid && t.running);

                return (
                  <button
                    key={pid}
                    type="button"
                    className={`hud-player-row ${p.eliminated ? 'eliminated' : ''} ${
                      isActive ? 'active-turn' : ''
                    } ${isFocused ? 'focused' : ''}`}
                    onClick={() => snapCameraPlayer(pid)}
                    title={`Вид от лица игрока ${p.nickname} (клик для фокуса камеры)`}
                  >
                    <div className="player-row-left">
                      <span className="player-cam-pin" aria-hidden="true">
                        {isFocused ? '🎯' : '👁️'}
                      </span>
                      <div className="player-name-block">
                        <span className="player-nickname">
                          {p.nickname} {isCurrentMe ? '(вы)' : ''}
                        </span>
                        <span className="player-hero">{heroNameOf(p.heroId)}</span>
                      </div>
                    </div>
                    <div className="player-row-right">
                      <span className="player-hp">❤ {p.lives}</span>
                      {p.eliminated ? (
                        <span className="badge badge-dead">💀</span>
                      ) : isActive ? (
                        playerTimer ? (
                          <TimerBadge remainingMs={playerTimer.remainingMs} isPulsing={isHurryPulsing} />
                        ) : (
                          <span className="badge badge-turn">ходит</span>
                        )
                      ) : p.battleReady ? (
                        <span className="badge badge-ready">✓</span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 2: Primary Action (Combat / Turn) */}
          <div className="hud-sidebar-section primary-section">
            <button
              className={`hud-sidebar-battle-btn ${
                myMain && (!is2v2 || !me.battleReady) ? 'active-cta' : ''
              } ${actionsSpent ? 'actions-spent' : ''}`}
              disabled={battleBtnDisabled}
              onClick={() => sendCommand({ type: 'go_battle', player: view.me })}
              onMouseEnter={() => setUi({ combatForecastHover: true })}
              onMouseLeave={() => setUi({ combatForecastHover: false })}
              onTouchStart={() => setUi({ combatForecastHover: true })}
              onTouchEnd={() => setUi({ combatForecastHover: false })}
              aria-label={battleBtnText}
            >
              <span className="battle-icon">⚔️</span>
              <span className="battle-label">{battleBtnText}</span>
            </button>

            {/* Team readiness in 2v2 */}
            {is2v2 && view.status === 'running' && (
              <div className="hud-team-readiness" aria-label="Готовность команды к бою">
                <div className="team-readiness-head">
                  <span className="hint">Команда:</span>
                  <span className={teamReadyCount === 2 ? 'ready-ok' : 'hint'}>
                    {teamReadyCount}/2 готовы
                  </span>
                </div>
                <div className="team-readiness-chips">
                  <span className={`team-chip ${me.battleReady ? 'ready' : 'waiting'}`}>
                    Вы: {me.battleReady ? '✓ готов' : 'ждём...'}
                  </span>
                  {teammate && (
                    <span className={`team-chip ${teammate.battleReady ? 'ready' : 'waiting'}`}>
                      {teammate.nickname}: {teammate.battleReady ? '✓ готов' : 'ждём...'}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Turn Actions */}
          <div className="hud-sidebar-section actions-section">
            <button
              className="hud-sidebar-action-btn draw-btn"
              disabled={!myMain || me.actions < CONFIG.extraDrawCost}
              onClick={() => sendCommand({ type: 'draw_extra', player: view.me })}
              title={
                !myMain
                  ? 'Доступно только в вашу основную фазу'
                  : me.actions < CONFIG.extraDrawCost
                  ? `Не хватает действий (нужно ${CONFIG.extraDrawCost})`
                  : `Взять карту за ${CONFIG.extraDrawCost} действие`
              }
            >
              <span className="btn-icon">🎴</span>
              <span className="btn-label">Добор</span>
              <span className="btn-badge">−{CONFIG.extraDrawCost} д.</span>
            </button>

            {/* Hurry up active opponent(s) */}
            {!myTurn &&
              view.status === 'running' &&
              view.activePlayers.map((pid) => {
                const opp = view.players[pid];
                return (
                  <button
                    key={pid}
                    className="hud-sidebar-action-btn hurry-btn"
                    onClick={() => {
                      useGame.getState().hurry(pid);
                      onHurryPulse();
                      showHint(`Отправлено напоминание игроку ${opp?.nickname ?? pid}!`);
                    }}
                    title={`Поторопить игрока ${opp?.nickname ?? pid}`}
                  >
                    <span className="btn-icon">⚡</span>
                    <span className="btn-label">Поторопить</span>
                    <span className="btn-sub">{opp?.nickname ?? pid}</span>
                  </button>
                );
              })}
          </div>

          {/* Section 4: Camera Snap Controls */}
          <div className="hud-sidebar-section camera-section">
            <div className="section-label">
              <span>🎥 Камера</span>
            </div>
            <div className="hud-camera-grid" role="group" aria-label="Переключение камеры">
              <button
                className={`cam-grid-btn ${
                  cameraSnap === 'top' || cameraSnap?.startsWith('top_') || cameraMode === 'top'
                    ? 'active'
                    : ''
                }`}
                onClick={() => {
                  if (cameraSnap === 'top' || cameraSnap?.startsWith('top_') || cameraMode === 'top') {
                    snapCameraPlayer();
                  } else {
                    snapCameraTop();
                  }
                }}
                title={
                  cameraSnap === 'top' || cameraSnap?.startsWith('top_') || cameraMode === 'top'
                    ? 'Опустить камеру к игроку'
                    : 'Вид строго сверху'
                }
                aria-label={
                  cameraSnap === 'top' || cameraSnap?.startsWith('top_') || cameraMode === 'top'
                    ? 'Опустить камеру к игроку'
                    : 'Вид строго сверху'
                }
              >
                <span className="cam-icon">📐</span>
                <span className="cam-text">Сверху</span>
              </button>
              <button
                className={`cam-grid-btn ${
                  cameraSnap === 'self' || cameraSnap === `player_${view.me}` || cameraMode === 'self'
                    ? 'active'
                    : ''
                }`}
                onClick={() => snapCameraPlayer(view.me)}
                title="Вид со стороны моей доски"
                aria-label="Вид со стороны моей доски"
              >
                <span className="cam-icon">👤</span>
                <span className="cam-text">Я</span>
              </button>
              <button
                className={`cam-grid-btn ${
                  cameraSnap === 'opponents' ||
                  (typeof cameraSnap === 'string' &&
                    cameraSnap.startsWith('player_') &&
                    cameraSnap !== `player_${view.me}`) ||
                  cameraMode === 'opponents'
                    ? 'active'
                    : ''
                }`}
                onClick={handleCycleOpponents}
                title="Вид со стороны противника (клик — следующий)"
                aria-label="Вид со стороны противника"
              >
                <span className="cam-icon">👥</span>
                <span className="cam-text">Враги</span>
              </button>
              <button
                className={`cam-grid-btn ${
                  cameraSnap === 'follow' || cameraMode === 'follow' ? 'active' : ''
                }`}
                onClick={() => setCameraSnap('follow')}
                title="Следить за ходом активного игрока"
                aria-label="Следить за ходом активного игрока"
              >
                <span className="cam-icon">🔄</span>
                <span className="cam-text">За ходом</span>
              </button>
            </div>
          </div>

          {/* Section 5: History & Emotes */}
          <div className="hud-sidebar-section utils-section">
            <button
              className={`hud-sidebar-action-btn journal-btn ${journalOpen ? 'active' : ''}`}
              onClick={onToggleJournal}
              title="Журнал боя и история ходов"
              aria-expanded={journalOpen}
            >
              <span className="btn-icon">📜</span>
              <span className="btn-label">История</span>
              {unreadCount > 0 && <span className="btn-counter-badge">{unreadCount}</span>}
              <span className="btn-dropdown-arrow">{journalOpen ? '▲' : '▼'}</span>
            </button>

            {/* Inline expandable journal container */}
            {journalOpen && (
              <div className="hud-sidebar-journal-panel" role="region" aria-label="История боя">
                <div className="journal-panel-head">
                  <span>Журнал ({view.journal.length})</span>
                  <button
                    type="button"
                    className="journal-dl-btn mini"
                    onClick={downloadJournal(view.journal, code)}
                    title="Скачать историю в текстовом файле (.txt)"
                  >
                    ⬇ .txt
                  </button>
                </div>
                <div className="journal-panel-scroll">
                  {view.journal.length === 0 ? (
                    <div className="journal-empty hint">История пока пуста</div>
                  ) : (
                    view.journal.slice(-60).map((line, idx) => (
                      <div key={idx} className="journal-log-entry">
                        {line}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            <div className="emotes-container">
              <button
                className={`hud-sidebar-action-btn emote-btn ${emotesOpen ? 'active' : ''}`}
                onClick={() => setEmotesOpen((v) => !v)}
                title="Эмоции и реплики героя"
                aria-expanded={emotesOpen}
              >
                <span className="btn-icon">💬</span>
                <span className="btn-label">Эмоции</span>
                <span className="btn-dropdown-arrow">{emotesOpen ? '▲' : '▼'}</span>
              </button>

              {/* Emotes Popover */}
              {emotesOpen && (
                <div
                  className="hud-emotes-popover"
                  role="dialog"
                  aria-label="Выбор эмоции или реплики"
                >
                  <div className="emotes-popover-head">
                    <span>Реплики и эмоции</span>
                    <button
                      className="emotes-close-btn"
                      onClick={() => setEmotesOpen(false)}
                      aria-label="Закрыть"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="emotes-grid">
                    {EMOTE_LINES.map((item) => (
                      <button
                        key={item.id}
                        className="emote-item-btn"
                        onClick={() => handleEmoteSelect(item)}
                      >
                        <span className="emote-emoji">{item.emoji}</span>
                        <span className="emote-label">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Section 6: Surrender (Danger) */}
          {view.status === 'running' && (
            <div className="hud-sidebar-section danger-section">
              <button
                className="hud-sidebar-danger-btn"
                onClick={() => setSurrenderModalOpen(true)}
                title="Сдаться в текущей партии"
              >
                <span className="btn-icon">🏳</span>
                <span className="btn-label">Сдаться</span>
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Surrender Confirmation Modal */}
      {surrenderModalOpen && (
        <div
          className="overlay surrender-overlay"
          onClick={() => setSurrenderModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="surrender-title"
        >
          <div className="panel surrender-dialog" onClick={(e) => e.stopPropagation()}>
            <h2 id="surrender-title">🏳 Сдаться в партии?</h2>
            <p className="hint">
              Вы уверены, что хотите признать поражение? Это действие необратимо — вашему герою будет
              засчитано поражение.
            </p>
            <div className="surrender-modal-actions">
              <button
                className="btn-danger surrender-confirm-btn"
                onClick={() => {
                  setSurrenderModalOpen(false);
                  sendCommand({ type: 'surrender', player: view.me });
                }}
              >
                Да, сдаться
              </button>
              <button
                className="secondary surrender-cancel-btn"
                autoFocus
                onClick={() => setSurrenderModalOpen(false)}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
