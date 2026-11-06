import { useEffect, useRef, useState } from 'react';
import { CONFIG } from '@card-wars/protocol';
import { sendCommand, setQuality, setUi, useGame } from '../../store';
import { pick, startForPending } from '../targeting';
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

  /**
   * Non-board answers (docs/MECHANICS-V2.md §H1): number and named branch.
   * For a pending `effect_step` there is no client TargetingState, so the
   * answer goes straight to resolve_choice.
   */
  const submitChoice = (candidate: Parameters<typeof pick>[2]) => {
    if (useGame.getState().ui.targeting) {
      targetingPick(candidate);
      return;
    }
    if (view.pending?.player === view.me) {
      sendCommand({ type: 'resolve_choice', player: view.me, answer: { targets: [candidate] } });
    }
  };

  const currentAsk = (() => {
    if (view.pending?.kind === 'target' || view.pending?.kind === 'effect_step') {
      const ability = view.pending.cardId
        ? catalog.find((c) => c.id === view.pending!.cardId)?.abilities?.[view.pending!.abilityIndex ?? 0]
        : heroCatalog.find((h) => h.id === view.players[view.pending!.player]!.heroId)?.ability;
      return ability?.targets?.[view.pending.askIndex ?? 0] ?? null;
    }
    if (targeting) return targeting.asks[targeting.askIndex] ?? null;
    return null;
  })();

  const [amountInput, setAmountInput] = useState('');
  const [distribution, setDistribution] = useState<string[]>([]);

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

  /** Числовой ввод и выбор ветки «ИЛИ» (docs/MECHANICS-V2.md §H1). */
  const nonBoardPicker = (() => {
    if (!currentAsk) return null;
    if (view.pending && view.pending.player !== view.me) return null;
    if (!view.pending && targeting?.mode !== 'active') return null;
    if (currentAsk.kind === 'amount') {
      const min = currentAsk.min ?? 0;
      const max = currentAsk.max ?? 99;
      const value = Number(amountInput);
      return (
        <span className="revealed-pool">
          <span className="hint">{currentAsk.label ?? 'Введите число'}: {min}–{max}</span>
          <input
            type="number"
            min={min}
            max={max}
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            style={{ width: 64 }}
            aria-label="Число"
          />
          <button
            className="mini"
            disabled={amountInput === '' || !Number.isInteger(value) || value < min || value > max}
            onClick={() => {
              submitChoice({ kind: 'amount', value });
              setAmountInput('');
            }}
          >
            ОК
          </button>
        </span>
      );
    }
    if (currentAsk.kind === 'choose_option') {
      return (
        <span className="revealed-pool">
          <span className="hint">{currentAsk.label ?? 'Выберите'}: </span>
          {(currentAsk.options ?? []).map((option) => (
            <button key={option} className="mini" onClick={() => submitChoice({ kind: 'option', option })}>
              {OPTION_LABELS[option] ?? option}
            </button>
          ))}
        </span>
      );
    }
    if (currentAsk.kind === 'damage_distribution') {
      const creatures = me.zones.flatMap((z) => (z.creature ? [z.creature] : []));
      const total = creatures.reduce((sum, c) => sum + c.damage, 0);
      const values = creatures.map((c, i) => (distribution[i] === undefined ? String(c.damage) : distribution[i]!));
      const numbers = values.map(Number);
      const valid =
        numbers.every((v) => Number.isInteger(v) && v >= 0) &&
        numbers.reduce((a, b) => a + b, 0) === total &&
        numbers.every((v, i) => v < creatures[i]!.effDefense);
      return (
        <span className="revealed-pool">
          <span className="hint">{currentAsk.label ?? 'Распределите урон'} (всего {total}):</span>
          {creatures.map((creature, i) => (
            <label key={creature.instanceId} className="hint">
              {cardNameById(creature.cardId)} (DEF {creature.effDefense}):{' '}
              <input
                type="number"
                min={0}
                max={Math.max(0, creature.effDefense - 1)}
                value={values[i]}
                onChange={(e) => {
                  const next = [...values];
                  next[i] = e.target.value;
                  setDistribution(next);
                }}
                style={{ width: 52 }}
                aria-label={`Урон для ${cardNameById(creature.cardId)}`}
              />
            </label>
          ))}
          <button
            className="mini"
            disabled={!valid}
            onClick={() => {
              submitChoice({ kind: 'amounts', values: numbers });
              setDistribution([]);
            }}
          >
            ОК
          </button>
        </span>
      );
    }
    return null;
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
          {nonBoardPicker}
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
              {nonBoardPicker}
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

/** RU labels for named branches declared in mechanics data (docs §H1). */
const OPTION_LABELS: Record<string, string> = {
  corn: 'Кукуруза',
  blue: 'Голубая равнина',
  good: 'Добрая земля',
  ice: 'Лёд',
  sand: 'Песок',
  swamp: 'Болото',
  rainbow: 'Радуга',
  ghost: 'Призрачная',
  all: 'Все существа',
  one: 'Одно существо',
  heal: 'Восстановить',
  damage: 'Нанести урон',
  deck_top: 'На верх колоды',
  hand: 'В руку',
};

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
