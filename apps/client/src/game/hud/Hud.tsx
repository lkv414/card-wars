import { useEffect, useRef, useState } from 'react';
import { CONFIG } from '@card-wars/protocol';
import { cards as catalog } from '@card-wars/content';
import { sendCommand, setQuality, setUi, useGame } from '../../store';

/** HUD поверх 3D-канваса (docs/UI.md «Панель игрока»): всё кнопочное — DOM. */
export function Hud({ code }: { code: string }) {
  const view = useGame((s) => s.view)!;
  const timer = useGame((s) => s.timer);
  const error = useGame((s) => s.error);
  const pendingPick = useGame((s) => s.ui.pendingPick);
  const quality = useGame((s) => s.ui.quality);
  const journalOpen = useGame((s) => s.ui.journalOpen);
  const me = view.players[view.me]!;
  const myTurn = view.activePlayers.includes(view.me) && view.status === 'running';
  const myMain = myTurn && view.phase === 'main';
  const lastAttempt = useRef<Record<string, unknown> | null>(null);
  const myTeam = me.teamId ? view.teams?.[me.teamId] ?? null : null;

  // сервер ответил target_required → включаем режим выбора цели в сцене
  useEffect(() => {
    if (error?.code !== 'target_required' || !lastAttempt.current) return;
    const base = lastAttempt.current;
    const instanceId = typeof base.instanceId === 'string' ? base.instanceId : null;
    const cardId = instanceId ? findCardIdInView(view, instanceId) : null;
    const effect = cardId ? catalog.find((c) => c.id === cardId)?.abilities.find((a) => a.effect)?.effect : undefined;
    const pick = effect && 'target' in effect && effect.target.kind === 'chosen_landscape' ? 'landscape' : 'creature';
    setUi({ pendingPick: { base, pick } });
  }, [error]);

  const send = (command: Parameters<typeof sendCommand>[0]) => {
    lastAttempt.current = command as Record<string, unknown>;
    sendCommand(command);
  };

  const activeNames = view.activePlayers
    .map((pid) => `${view.players[pid]?.nickname ?? pid}${view.players[pid]?.battleReady ? ' ✓' : ''}`)
    .join(', ');

  return (
    <div className="hud">
      <div className="hud-top">
        <b>Комната {code}</b>
        {view.status === 'running' && (
          <span>
            круг {view.round} · ход {view.turn} · {phaseRu(view.phase)}
            {view.mode === 'teams' && view.teamVariant
              ? ` · 2 на 2 (${view.teamVariant === 'wall' ? 'стенка' : 'соседи'})`
              : ''} · сейчас: {activeNames}
          </span>
        )}
        {timer?.paused && <span className="timer paused">Пауза: ожидание игрока</span>}
        {!timer?.paused &&
          timer?.timers
            .filter((t) => t.running)
            .map((t) => (
              <span key={t.player} className="timer-line">
                {view.players[t.player]?.nickname}:{' '}
                <TimerBadge key={timer.serverNowMs} remainingMs={t.remainingMs} />
              </span>
            ))}
        <span className="hud-spacer" />
        <span className="hint">
          кач-во:{' '}
          <button className="mini" onClick={() => setQuality(quality === 'high' ? 'low' : 'high')}>
            {quality === 'high' ? 'высокое' : 'низкое'}
          </button>
        </span>
      </div>

      <div className="hud-stats">
        <span>❤ {me.lives}{me.maxLives !== CONFIG.startingLives ? ` / ${me.maxLives}` : ''}</span>
        {myTeam && <span className="hint">команда: ❤ {myTeam.lives} / {myTeam.maxLives}</span>}
        <span>действия: {me.actions}</span>
        <span>рука: {me.handCount}</span>
        {view.mode === 'teams' && view.activePlayers.includes(view.me) && (
          <span className={me.battleReady ? 'ready-ok' : 'hint'}>
            {me.battleReady ? 'готов к бою' : 'не готов к бою'}
          </span>
        )}
      </div>

      <div className="hud-players">
        {view.order.map((pid) => {
          const p = view.players[pid]!;
          const team = p.teamId ? view.teams?.[p.teamId] : null;
          return (
            <div key={pid} className={`hud-player ${p.eliminated ? 'dead' : ''}`}>
              <b>{p.nickname}</b>
              {team && <span className="hint"> · {team.id === 'team-a' ? 'A' : 'B'}</span>}
              <span className="lives"> ❤ {p.lives}</span>
              <span className="hint">
                {p.eliminated
                  ? ' выбыл'
                  : view.activePlayers.includes(pid)
                    ? p.battleReady
                      ? ' готов'
                      : ' ходит'
                    : ''}
              </span>
            </div>
          );
        })}
      </div>

      {view.status === 'running' && (
        <div className="hud-actions">
          {myMain && (
            <>
              <button
                disabled={view.mode === 'teams' && me.battleReady}
                onClick={() => send({ type: 'go_battle', player: view.me })}
              >
                {view.mode === 'teams' ? (me.battleReady ? 'Готов' : 'В бой (готовность)') : 'В бой'}
              </button>
              <button
                disabled={me.actions < CONFIG.extraDrawCost}
                onClick={() => send({ type: 'draw_extra', player: view.me })}
              >
                Добор (−{CONFIG.extraDrawCost} действие)
              </button>
            </>
          )}
          {!myTurn &&
            view.activePlayers.map((pid) => (
              <button key={pid} onClick={() => useGame.getState().hurry(pid)}>
                Поторопить {view.players[pid]?.nickname ?? ''}
              </button>
            ))}
          <button onClick={() => confirm('Сдаться?') && send({ type: 'surrender', player: view.me })}>Сдаться</button>
        </div>
      )}

      {pendingPick && (
        <div className="pending-banner">
          Выберите {pendingPick.pick === 'creature' ? 'существо на поле' : 'землю'}{' '}
          <button className="mini" onClick={() => setUi({ pendingPick: null })}>
            Отмена
          </button>
        </div>
      )}
      {error && error.code !== 'target_required' && <div className="error-line hud-error">{error.message}</div>}

      <div className={`hud-journal ${journalOpen ? '' : 'collapsed'}`}>
        <div className="journal-head">
          <b>Журнал</b>
          <button className="mini" onClick={() => setUi({ journalOpen: !journalOpen })}>
            {journalOpen ? 'свернуть' : 'развернуть'}
          </button>
        </div>
        {journalOpen &&
          view.journal.slice(-30).map((line, i) => (
            <div key={i} className="log-line">
              {line}
            </div>
          ))}
      </div>

      {view.status === 'mulligan' && (
        <div className="overlay">
          <div className="panel mulligan">
            <h2>Муллиган</h2>
            <p className="hint">
              {me.mulliganDecision
                ? 'Решение принято — ждём остальных игроков'
                : 'Оставить руку или перемешать и взять 5 новых'}
            </p>
            <div className="row">
              <button disabled={me.mulliganDecision !== null} onClick={() => send({ type: 'keep_hand', player: view.me })}>
                Оставить
              </button>
              <button disabled={me.mulliganDecision !== null} onClick={() => send({ type: 'mulligan', player: view.me })}>
                Перемешать
              </button>
            </div>
          </div>
        </div>
      )}

      {view.status === 'finished' && (
        <div className="overlay">
          <div className="panel">
            <h2>{won(view) ? 'Победа!' : 'Поражение'}</h2>
            <p className="hint">
              Причина:{' '}
              {view.finishReason === 'surrender' ? 'сдача' : view.finishReason === 'disconnect' ? 'обрыв соединения' : 'жизни на нуле'}
            </p>
            {view.mode === 'teams' && view.teams && (
              <p className="hint">
                Победила команда:{' '}
                {Object.values(view.teams)
                  .filter((team) => team.playerIds.some((pid) => view.winners?.includes(pid)))
                  .map((team) => team.playerIds.map((pid) => view.players[pid]?.nickname ?? pid).join(' и '))
                  .join('; ') || '—'}
              </p>
            )}
            <button onClick={downloadJournal(view.journal, code)}>Скачать журнал (.txt)</button>
            <button onClick={() => (location.href = '/')}>В меню</button>
          </div>
        </div>
      )}
    </div>
  );
}

function won(view: NonNullable<ReturnType<typeof useGame.getState>['view']>): boolean {
  if (view.winners?.includes(view.me)) return true;
  const teamId = view.players[view.me]?.teamId;
  if (!teamId) return false;
  const team = view.teams?.[teamId];
  return Boolean(team && team.playerIds.some((pid) => view.winners?.includes(pid)));
}

function phaseRu(phase: string): string {
  return phase === 'main' ? 'основная фаза' : phase === 'draw' ? 'добор' : 'бой';
}

function findCardIdInView(view: NonNullable<ReturnType<typeof useGame.getState>['view']>, instanceId: string): string | null {
  for (const hand of view.myHand) if (hand.instanceId === instanceId) return hand.cardId;
  for (const pid of view.order) {
    const p = view.players[pid]!;
    for (const zone of p.zones) {
      if (zone.creature?.instanceId === instanceId) return zone.creature.cardId;
      if (zone.building?.instanceId === instanceId) return zone.building.cardId;
    }
    if (p.companion?.instanceId === instanceId) return p.companion.cardId;
  }
  return null;
}

function TimerBadge({ remainingMs }: { remainingMs: number }) {
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
    <span className={`timer ${left < 15_000 ? 'low' : ''}`}>
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </span>
  );
}

function downloadJournal(journal: string[], code: string): () => void {
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
