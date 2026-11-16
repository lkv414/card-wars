import { useCallback, useEffect, useState } from 'react';
import { CONFIG, type PlayerView } from '@card-wars/protocol';
import {
  cycleCameraPlayer,
  emitEmote,
  sendCommand,
  setCameraSnap,
  setUi,
  showHint,
  snapCameraPlayer,
  snapCameraTop,
  useGame,
} from '../../store';

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

/**
 * Dedicated right-hand action sidebar (Split-Screen layout):
 * Keeps all game controls cleanly organized instead of floating over the 3D table.
 */
export function HudSidebar({
  code: _code,
  view,
  unreadCount,
  journalOpen,
  onToggleJournal,
  isHurryPulsing: _isHurryPulsing,
  onHurryPulse,
}: HudSidebarProps) {
  const cameraMode = useGame((s) => s.ui.cameraMode);
  const cameraSnap = useGame((s) => s.ui.cameraSnap);
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

  const phaseLabel = view.phase === 'main' ? 'Основная' : view.phase === 'combat' ? 'Бой' : 'Добор';

  return (
    <>
      {/* Mobile Floating Bottom Bar for quick combat & drawer toggle */}
      <div className="hud-mobile-bottom-bar" role="toolbar" aria-label="Быстрые действия">
        <button
          className={`hud-mobile-btn-battle ${myMain && (!is2v2 || !me.battleReady) ? 'pulse' : ''}`}
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
          <span className="btn-label">Действия</span>
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
        {/* Header / Collapse Bar */}
        <div className="hud-sidebar-header">
          <div className="hud-sidebar-meta">
            <span className="hud-sidebar-title">Ход {view.turn}</span>
            <span className={`hud-sidebar-phase-badge phase-${view.phase}`}>
              {phaseLabel}
            </span>
          </div>
          <button
            className="hud-sidebar-toggle-btn"
            onClick={toggleDesktopCollapse}
            title={desktopCollapsed ? 'Развернуть панель' : 'Свернуть панель'}
            aria-label={desktopCollapsed ? 'Развернуть панель' : 'Свернуть панель'}
          >
            {desktopCollapsed ? '◀' : '▶'}
          </button>
          <button
            className="hud-sidebar-mobile-close"
            onClick={() => setMobileDrawerOpen(false)}
            aria-label="Закрыть панель"
          >
            ✕
          </button>
        </div>

        <div className="hud-sidebar-scroll">
          {/* Section 1: Primary Action (Combat / Turn) */}
          <div className="hud-sidebar-section primary-section">
            <button
              className={`hud-sidebar-battle-btn ${
                myMain && (!is2v2 || !me.battleReady) ? 'active-cta' : ''
              }`}
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

          {/* Section 2: Turn Actions */}
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

          {/* Section 3: Camera Snap Controls */}
          <div className="hud-sidebar-section camera-section">
            <div className="section-label">
              <span>🎥 Камера</span>
            </div>
            <div className="hud-camera-grid" role="group" aria-label="Переключение камеры">
              <button
                className={`cam-grid-btn ${
                  cameraSnap === 'top' || cameraMode === 'top' ? 'active' : ''
                }`}
                onClick={() => snapCameraTop()}
                title="Вид строго сверху"
                aria-label="Вид строго сверху"
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

          {/* Section 4: History & Emotes */}
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
            </button>

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

          {/* Section 5: Surrender (Danger) */}
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