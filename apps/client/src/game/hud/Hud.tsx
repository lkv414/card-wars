import { useEffect, useRef, useState } from 'react';
import { cards as catalog } from '@card-wars/content';
import { sendCommand, setQuality, setUi, useGame } from '../../store';

/** HUD поверх 3D-канваса (docs/UI.md «Панель игрока»): всё кнопочное — DOM. */
export function Hud({ code }: { code: string }) {
  const view = useGame((s) => s.view)!;
  const timer = useGame((s) => s.timer);
  const error = useGame((s) => s.error);
  const pendingPick = useGame((s) => s.ui.pendingPick);
  const quality = useGame((s) => s.ui.quality);
  const me = view.players[view.me]!;
  const myMain = view.activePlayer === view.me && view.status === 'running' && view.phase === 'main';
  const myTurn = view.activePlayer === view.me && view.status === 'running';
  const lastAttempt = useRef<Record<string, unknown> | null>(null);

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

  return (
    <div className="hud">
      <div className="hud-top">
        <b>Комната {code}</b>
        {view.status === 'running' && (
          <span>
            круг {view.round} · ход {view.turn} · {phaseRu(view.phase)} · сейчас: {view.players[view.activePlayer]?.nickname}
          </span>
        )}
        {timer?.running && !timer.paused && <TimerBadge running remainingMs={timer.remainingMs} serverNowMs={timer.serverNowMs} />}
        {timer?.paused && <span className="timer paused">Пауза: ожидание игрока</span>}
        <span className="hud-spacer" />
        <span className="hint">
          кач-во:{' '}
          <button className="mini" onClick={() => setQuality(quality === 'high' ? 'low' : 'high')}>
            {quality === 'high' ? 'высокое' : 'низкое'}
          </button>
        </span>
      </div>

      <div className="hud-stats">
        <span>❤ {me.lives}</span>
        <span>действия: {me.actions}</span>
        <span>рука: {me.handCount}</span>
      </div>

      {view.status === 'running' && (
        <div className="hud-actions">
          {myMain && (
            <>
              <button onClick={() => send({ type: 'go_battle', player: view.me })}>В бой</button>
              <button disabled={me.actions < 1} onClick={() => send({ type: 'draw_extra', player: view.me })}>
                Добор (−1 действие)
              </button>
            </>
          )}
          {!myTurn && <button onClick={() => useGame.getState().hurry()}>Поторопить</button>}
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
      {error && error.code !== 'target_required' && <div className="error-line">{error.message}</div>}

      <div className="hud-journal">
        <b>Журнал</b>
        {view.journal.slice(-30).map((line, i) => (
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
              {me.mulliganDecision ? 'Решение принято — ждём второго игрока' : 'Оставить руку или перемешать и взять 5 новых'}
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
            <h2>{view.winners?.includes(view.me) ? 'Победа!' : 'Поражение'}</h2>
            <p className="hint">
              Причина:{' '}
              {view.finishReason === 'surrender' ? 'сдача' : view.finishReason === 'disconnect' ? 'обрыв соединения' : 'жизни на нуле'}
            </p>
            <button onClick={downloadJournal(view.journal, code)}>Скачать журнал (.txt)</button>
            <button onClick={() => (location.href = '/')}>В меню</button>
          </div>
        </div>
      )}
    </div>
  );
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
  }
  return null;
}

function TimerBadge({ remainingMs, serverNowMs }: { running: boolean; remainingMs: number; serverNowMs: number }) {
  const [now, setNow] = useState(Date.now());
  const receivedAt = useRef(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const skew = serverNowMs - receivedAt.current;
  const left = Math.max(0, remainingMs - (now + skew - receivedAt.current));
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
