import { useEffect, useRef, useState } from 'react';
import { CONFIG } from '@card-wars/protocol';
import { sendCommand, setQuality, setUi, useGame } from '../../store';
import { pick, startForActive, startForPending, validTargets } from '../targeting';
import { heroes as heroCatalog } from '@card-wars/content';
import { cards as catalog } from '@card-wars/content';

/** HUD поверх 3D-канваса (docs/UI.md «Панель игрока»): всё кнопочное — DOM. */
export function Hud({ code }: { code: string }) {
  const view = useGame((s) => s.view)!;
  const timer = useGame((s) => s.timer);
  const error = useGame((s) => s.error);
  const quality = useGame((s) => s.ui.quality);
  const journalOpen = useGame((s) => s.ui.journalOpen);
  const me = view.players[view.me]!;
  const myTurn = view.activePlayers.includes(view.me) && view.status === 'running';
  const myMain = myTurn && view.phase === 'main';
  const myTeam = me.teamId ? view.teams?.[me.teamId] ?? null : null;
  const targeting = useGame((st) => st.ui.targeting);
  const myHero = heroCatalog.find((h) => h.id === me.heroId);
  const heroActive = myHero?.ability && myHero.ability.kind === 'active' ? myHero.ability : null;

  useEffect(() => {
    const ui = useGame.getState().ui;
    if (view.pending && view.pending.player === view.me && view.pending.kind === 'target' && !ui.targeting) {
      const state = startForPending(view, view.pending);
      if (state) setUi({ targeting: state });
    }
    if (!view.pending && ui.targeting && ui.targeting.mode === 'pending') {
      setUi({ targeting: null });
    }
  }, [view.pending, view]);

  const targetingPick = (candidate: Parameters<typeof pick>[2]) => {
    const ui = useGame.getState().ui;
    if (!ui.targeting) return;
    const result = pick(view, ui.targeting, candidate);
    if (!result.accepted) return;
    if (result.command) {
      sendCommand(result.command);
      setUi({ targeting: result.nextState ?? null });
    } else if (result.nextState) {
      setUi({ targeting: result.nextState });
    }
  };

  const startHeroAbility = () => {
    if (!heroActive) return;
    const state = startForActive(view, 'hero_ability', null, me.heroId);
    if (state) {
      setUi({ targeting: state });
      sendCommand(state.base as Parameters<typeof sendCommand>[0]);
    } else {
      sendCommand({ type: 'hero_ability', player: view.me });
    }
  };
  const revealedForMe = view.revealed[view.me] ?? [];
  const revealedForPendingPlayer = view.pending ? view.revealed[view.pending.player] ?? [] : [];
  const cardNameById = (cardId: string): string => catalog.find((card) => card.id === cardId)?.name ?? cardId;

  /**
   * Выбор карты из стопки сброса (Поднятие мертвых, Лунный урожай).
   * Сброс публичен, но в 3D видна только верхняя карта — поэтому перечисляем
   * карты списком в баннере ожидания (как вскрытые карты выше).
   */
  const discardPickers = (() => {
    const askInfo = (() => {
      if (view.pending?.kind === 'target' || view.pending?.kind === 'effect_step') {
        const ability = view.pending.cardId
          ? catalog.find((c) => c.id === view.pending!.cardId)?.abilities?.[view.pending!.abilityIndex ?? 0]
          : heroCatalog.find((h) => h.id === view.players[view.pending!.player]!.heroId)?.ability;
        const ask = ability?.targets?.[view.pending.askIndex ?? 0];
        return ask ? { kind: ask.kind, filter: ask.filter } : null;
      }
      if (targeting) {
        const ask = targeting.asks[targeting.askIndex];
        return ask ? { kind: ask.kind, filter: ask.filter } : null;
      }
      return null;
    })();
    if (!askInfo || (askInfo.kind !== 'own_discard_card' && askInfo.kind !== 'any_discard_card' && askInfo.kind !== 'visible_card')) {
      return null;
    }
    const filter = askInfo.filter;
    const pools: Array<{ label: string; cards: Array<{ instanceId: string; cardId: string }> }> = [];
    const usable = (cardId: string): boolean => {
      if (!filter) return true;
      const card = catalog.find((c) => c.id === cardId);
      if (!card) return false;
      if (filter.cardType && card.type !== filter.cardType) return false;
      if (filter.maxCost !== undefined && card.cost > filter.maxCost) return false;
      if (filter.cardIds && !filter.cardIds.includes(cardId)) return false;
      return true;
    };
    if (askInfo.kind === 'own_discard_card') {
      pools.push({
        label: 'твой сброс',
        cards: (view.players[view.me]?.discard ?? []).filter((c) => usable(c.cardId)),
      });
    } else {
      for (const pid of view.order) {
        const p = view.players[pid]!;
        const cards = p.discard.filter((c) => usable(c.cardId));
        if (cards.length === 0) continue;
        pools.push({ label: `сброс: ${p.nickname}`, cards });
      }
    }
    return (
      <div className="revealed-picker" aria-label="Карты из сброса">
        {pools.map((pool) => (
          <span key={pool.label} className="revealed-pool">
            <span className="hint">{pool.label}:</span>
            {pool.cards.map((card) => (
              <button
                key={card.instanceId}
                className="mini revealed-card"
                onClick={() => targetingPick({ kind: 'card', instanceId: card.instanceId })}
              >
                {cardNameById(card.cardId)}
              </button>
            ))}
          </span>
        ))}
      </div>
    );
  })();

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
                onClick={() => sendCommand({ type: 'go_battle', player: view.me })}
              >
                {view.mode === 'teams' ? (me.battleReady ? 'Готов' : 'В бой (готовность)') : 'В бой'}
              </button>
              <button
                disabled={me.actions < CONFIG.extraDrawCost}
                onClick={() => sendCommand({ type: 'draw_extra', player: view.me })}
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
          <button onClick={() => confirm('Сдаться?') && sendCommand({ type: 'surrender', player: view.me })}>Сдаться</button>
        </div>
      )}

      {error && <div className="error-line hud-error">{error.message}</div>}

      {targeting && targeting.mode === 'active' && (
        <div className="pending-banner">
          <span>
            {targeting.label} — цель {targeting.askIndex + 1}/{targeting.asks.length}
          </span>
          <button className="mini" onClick={() => setUi({ targeting: null })}>
            Отмена
          </button>
        </div>
      )}
      {view.pending && (
        <div className="pending-banner">
          {view.pending.player === view.me ? (
            <>
              {view.pending.kind === 'optional'
                ? 'Применить способность?'
                : `Выберите цель (${(view.pending.askIndex ?? 0) + 1}${view.pending.askCount ? `/${view.pending.askCount}` : ''})`}
              {view.pending.kind === 'optional' && (
                <button
                  className="mini"
                  onClick={() => sendCommand({ type: 'resolve_choice', player: view.me, answer: { proceed: true } })}
                >
                  Да
                </button>
              )}
              <button
                className="mini"
                onClick={() =>
                  sendCommand({
                    type: 'resolve_choice',
                    player: view.me,
                    answer: view.pending!.kind === 'optional' ? { proceed: false } : {},
                  })
                }
              >
                Пропустить
              </button>
              {(() => {
                if (view.pending!.kind !== 'target') return null;
                const ability = view.pending!.cardId
                  ? catalog.find((c) => c.id === view.pending!.cardId)?.abilities?.[view.pending!.abilityIndex ?? 0]
                  : heroCatalog.find((h) => h.id === view.players[view.pending!.player]!.heroId)?.ability;
                const ask = ability?.targets?.[view.pending!.askIndex ?? 0];
                if (!ask || ask.kind !== 'opponent_player') return null;
                return view.order
                  .filter((pid) => pid !== view.me)
                  .map((pid) => (
                    <button key={pid} className="mini" onClick={() => targetingPick({ kind: 'player', playerId: pid })}>
                      {view.players[pid]?.nickname ?? pid}
                    </button>
                  ));
              })()}
              {discardPickers}
              {(() => {
                // «Восстанови или нанеси урон» — выбор режима.
                const askKind = (() => {
                  if (view.pending?.kind === 'target' || view.pending?.kind === 'effect_step') {
                    const ability = view.pending.cardId
                      ? catalog.find((c) => c.id === view.pending!.cardId)?.abilities?.[view.pending!.abilityIndex ?? 0]
                      : heroCatalog.find((h) => h.id === view.players[view.pending!.player]!.heroId)?.ability;
                    return ability?.targets?.[view.pending.askIndex ?? 0]?.kind;
                  }
                  if (targeting) return targeting.asks[targeting.askIndex]?.kind;
                  return undefined;
                })();
                if (askKind !== 'heal_or_damage') return null;
                return (
                  <>
                    <button className="mini" onClick={() => targetingPick({ kind: 'mode', mode: 'heal' })}>
                      Восстанови
                    </button>
                    <button className="mini" onClick={() => targetingPick({ kind: 'mode', mode: 'damage' })}>
                      Нанеси урон
                    </button>
                  </>
                );
              })()}
            </>
          ) : (
            <>Ожидается решение: {view.players[view.pending.player]?.nickname ?? view.pending.player}</>
          )}
          {revealedForPendingPlayer.length > 0 && (
            <div className="revealed-picker" aria-label="Открытые карты">
              {revealedForPendingPlayer.map((card) =>
                view.pending?.player === view.me ? (
                  <button
                    key={card.instanceId}
                    className="mini revealed-card"
                    onClick={() =>
                      sendCommand({
                        type: 'resolve_choice',
                        player: view.me,
                        answer: { targets: [{ kind: 'card', instanceId: card.instanceId }] },
                      })
                    }
                  >
                    {cardNameById(card.cardId)}
                  </button>
                ) : (
                  <span key={card.instanceId} className="revealed-card spectator">
                    {cardNameById(card.cardId)}
                  </span>
                ),
              )}
            </div>
          )}
        </div>
      )}

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
              <button disabled={me.mulliganDecision !== null} onClick={() => sendCommand({ type: 'keep_hand', player: view.me })}>
                Оставить
              </button>
              <button disabled={me.mulliganDecision !== null} onClick={() => sendCommand({ type: 'mulligan', player: view.me })}>
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
