import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cards as contentCards, heroes } from '@card-wars/content';
import type { CardView, Command, PlayerView } from '@card-wars/protocol';
import { GameConnection, type ConnectionState } from './connection';
import './styles.css';

const cardName = (cardId: string): string => contentCards.find((c) => c.id === cardId)?.name ?? cardId;
const cardMeta = (cardId: string) => contentCards.find((c) => c.id === cardId);
const heroName = (heroId: string): string => heroes.find((h) => h.id === heroId)?.name ?? heroId;

/** Возвращает [состояние, соединение]. */
function useGameConnection(code: string, nickname: string): [ConnectionState | null, GameConnection | null] {
  const conn = useMemo(() => new GameConnection(code, nickname), [code, nickname]);
  const [state, setState] = useState<ConnectionState | null>(null);
  useEffect(() => {
    conn.connect();
    const off = conn.subscribe(setState);
    return () => {
      off();
      conn.close();
    };
  }, [conn]);
  return [state, conn];
}

export function App() {
  const [nickname, setNickname] = useState(() => localStorage.getItem('cw-nickname') ?? '');
  const [codeInput, setCodeInput] = useState('');
  const [activeCode, setActiveCode] = useState<string | null>(() => {
    const match = /^\/play\/(\d{4})$/.exec(location.pathname);
    return match?.[1] ?? null;
  });

  if (activeCode) {
    return nickname.trim() ? (
      <GameScreen key={activeCode} code={activeCode} nickname={nickname.trim()} />
    ) : (
      <NicknameScreen code={activeCode} onDone={(nick) => {
        localStorage.setItem('cw-nickname', nick);
        setNickname(nick);
      }} />
    );
  }

  const enter = (code: string) => {
    if (nickname.trim()) localStorage.setItem('cw-nickname', nickname.trim());
    history.pushState(null, '', `/play/${code}`);
    setActiveCode(code);
  };

  return (
    <div className="center-screen">
      <div className="panel menu">
        <h1>Card Wars</h1>
        <p className="hint">Технический этап: DOM-клиент для проверки правил и сети</p>
        <input placeholder="Ник" value={nickname} onChange={(e) => setNickname(e.target.value)} />
        <button disabled={!nickname.trim()} onClick={() => enter(String(Math.floor(1000 + Math.random() * 9000)))}>
          Создать лобби
        </button>
        <div className="row">
          <input
            placeholder="Код (4 цифры)"
            inputMode="numeric"
            maxLength={4}
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && /^\d{4}$/.test(codeInput) && enter(codeInput)}
          />
          <button disabled={!/^\d{4}$/.test(codeInput) || !nickname.trim()} onClick={() => enter(codeInput)}>
            Войти
          </button>
        </div>
      </div>
    </div>
  );
}

function NicknameScreen({ code, onDone }: { code: string; onDone: (nick: string) => void }) {
  const [nick, setNick] = useState('');
  return (
    <div className="center-screen">
      <div className="panel">
        <h2>Комната {code}</h2>
        <input autoFocus placeholder="Ник" value={nick} onChange={(e) => setNick(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && nick.trim() && onDone(nick.trim())} />
        <button disabled={!nick.trim()} onClick={() => onDone(nick.trim())}>
          Войти
        </button>
      </div>
    </div>
  );
}

interface PendingChoice {
  base: Record<string, unknown>;
  pick: 'creature' | 'landscape';
}

function GameScreen({ code, nickname }: { code: string; nickname: string }) {
  const [state, conn] = useGameConnection(code, nickname);
  const [selectedHand, setSelectedHand] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingChoice | null>(null);
  const lastAttempt = useRef<Record<string, unknown> | null>(null);

  const send = useCallback(
    (command: Command) => {
      lastAttempt.current = command as Record<string, unknown>;
      conn?.sendCommand(command);
    },
    [conn],
  );

  // server answered target_required → enter target picking for the last command
  useEffect(() => {
    if (state?.error?.code === 'target_required' && lastAttempt.current) {
      const base = lastAttempt.current;
      const cardId =
        typeof base.instanceId === 'string'
          ? Object.values(state.view?.players[state.view.me]?.zones ?? {}).flatMap((z) => [
              ...(z?.creature ? [z.creature] : []),
              ...(z?.building ? [z.building] : []),
            ]).find((c) => c.instanceId === base.instanceId)?.cardId ??
            state.view?.myHand.find((c) => c.instanceId === base.instanceId)?.cardId
          : undefined;
      const meta = cardId ? cardMeta(cardId) : undefined;
      const effect = meta?.abilities.find((a) => a.effect)?.effect;
      const pickKind = effect && 'target' in effect && effect.target.kind === 'chosen_landscape' ? 'landscape' : 'creature';
      setPending({ base, pick: pickKind });
    }
  }, [state?.error]);

  if (!state) return <div className="center-screen hint">Подключение…</div>;
  if (state.status === 'closed') {
    return (
      <div className="center-screen">
        <div className="panel">
          <h2>Соединение потеряно</h2>
          <p className="hint">Токен сессии сохранён — перезагрузка вернёт вас в партию</p>
          <button onClick={() => location.reload()}>Переподключиться</button>
        </div>
      </div>
    );
  }
  if (!state.you || !state.lobby || (state.status === 'lobby' && !state.view)) {
    return (
      <div className="center-screen">
        <div className="panel menu">
          <h2>Лобби {code}</h2>
          {state.lobby?.players.map((p) => (
            <div key={p.id} className={p.connected ? '' : 'disconnected'}>
              {p.nickname} {state.lobby?.host === p.id ? '(хост)' : ''} {p.connected ? '' : '— нет связи'}
            </div>
          ))}
          <button onClick={() => navigator.clipboard?.writeText(`${location.origin}/play/${code}`)}>
            Скопировать ссылку
          </button>
          {state.you?.isHost ? (
            <button
              disabled={(state.lobby?.players.filter((p) => p.connected).length ?? 0) < 2}
              onClick={() => conn?.start()}
            >
              Начать матч
            </button>
          ) : (
            <p className="hint">Ждём, когда хост начнёт матч…</p>
          )}
          {state.error && <div className="error-line">{state.error.message}</div>}
        </div>
      </div>
    );
  }
  if (!state.view) return <div className="center-screen hint">Ожидание начала матча…</div>;

  const view = state.view;
  const me = view.players[view.me]!;
  const myTurn = view.activePlayer === view.me && view.status === 'running';
  const myMain = myTurn && view.phase === 'main';
  const selectedMeta = selectedHand ? cardMeta(view.myHand.find((c) => c.instanceId === selectedHand)?.cardId ?? '') : undefined;

  const playToZone = (zone: number) => {
    if (!selectedHand) return;
    send({ type: 'play_card', player: view.me, instanceId: selectedHand, zone });
    setSelectedHand(null);
  };

  const pickCreature = (instanceId: string) => {
    if (!pending) return;
    const choices = { ...((pending.base.choices as object) ?? {}), creature: instanceId };
    conn?.sendCommand({ ...pending.base, choices } as unknown as Command);
    setPending(null);
  };
  const pickLandscape = (playerId: string, zone: number) => {
    if (!pending) return;
    const choices = { ...((pending.base.choices as object) ?? {}), landscape: { player: playerId, zone } };
    conn?.sendCommand({ ...pending.base, choices } as unknown as Command);
    setPending(null);
  };

  return (
    <div className="game">
      <header>
        <b>Комната {code}</b>
        {view.status === 'running' && (
          <span>
            {' '}— круг {view.round}, ход {view.turn}, фаза {phaseRu(view.phase)}, сейчас:{' '}
            {view.players[view.activePlayer]?.nickname}
          </span>
        )}
        {state.timer?.running && <TimerBadge timer={state.timer} />}
      </header>
      {state.timer?.paused && <div className="pending-banner">Партия на паузе — ожидание возвращения игрока</div>}

      <div className="boards">
        {[...view.order].reverse().map((pid) => (
          <PlayerBoard
            key={pid}
            view={view}
            pid={pid}
            isMe={pid === view.me}
            myMain={myMain}
            placeMode={Boolean(selectedHand) && pid === view.me && selectedMeta?.type !== 'spell'}
            pickCreature={pending?.pick === 'creature'}
            pickLandscape={pending?.pick === 'landscape'}
            onZoneClick={playToZone}
            onPickCreature={pickCreature}
            onPickLandscape={pickLandscape}
            onFloop={(instanceId) => send({ type: 'floop', player: view.me, instanceId })}
          />
        ))}
      </div>

      {view.status === 'mulligan' && (
        <div className="panel mulligan">
          <b>Муллиган</b>
          <span className="hint">
            {me.mulliganDecision
              ? 'Решение принято — ждём второго игрока'
              : 'Оставить стартовую руку или перемешать её в колоду и взять 5 новых'}
          </span>
          <button disabled={me.mulliganDecision !== null} onClick={() => send({ type: 'keep_hand', player: view.me })}>
            Оставить руку
          </button>
          <button disabled={me.mulliganDecision !== null} onClick={() => send({ type: 'mulligan', player: view.me })}>
            Перемешать
          </button>
        </div>
      )}

      {view.status === 'running' && (
        <div className="actions">
          {myMain && (
            <>
              <button onClick={() => send({ type: 'go_battle', player: view.me })}>В бой</button>
              <button disabled={me.actions < 1} onClick={() => send({ type: 'draw_extra', player: view.me })}>
                Добор (−1 действие)
              </button>
            </>
          )}
          {!myTurn && <button onClick={() => conn?.hurry()}>Поторопить</button>}
          <button onClick={() => confirm('Сдаться?') && send({ type: 'surrender', player: view.me })}>Сдаться</button>
        </div>
      )}

      <div className="hand panel">
        <b>Рука ({me.handCount})</b> <span className="hint">— действий: {me.actions}</span>
        <div className="cards-row">
          {view.myHand.map(({ instanceId, cardId }) => {
            const meta = cardMeta(cardId);
            return (
              <div
                key={instanceId}
                className={`card ${selectedHand === instanceId ? 'selected' : ''}`}
                onClick={() => setSelectedHand(selectedHand === instanceId ? null : instanceId)}
              >
                <b>{cardName(cardId)}</b>
                <span className="hint">
                  {meta?.type === 'creature' ? `${meta.attack}/${meta.defense}` : meta?.type === 'spell' ? 'заклинание' : meta?.type === 'building' ? 'строение' : ''}
                  {' '}· {meta?.cost ?? 0} д. · {meta?.landType === 'rainbow' ? 'радуга' : meta?.landType}
                </span>
                {selectedHand === instanceId && (
                  <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                    {meta?.type === 'spell' ? (
                      <button
                        onClick={() => {
                          send({ type: 'play_card', player: view.me, instanceId });
                          setSelectedHand(null);
                        }}
                      >
                        Разыграть
                      </button>
                    ) : (
                      <span className="hint">кликни зону на своей половине</span>
                    )}
                    {myMain && (
                      <button onClick={() => send({ type: 'discard_from_hand', player: view.me, instanceId })}>Сброс</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {pending && (
        <div className="pending-banner">
          Выберите {pending.pick === 'creature' ? 'существо на поле' : 'землю'}{' '}
          <button onClick={() => setPending(null)}>Отмена</button>
        </div>
      )}
      {state.error && state.error.code !== 'target_required' && <div className="error-line">{state.error.message}</div>}

      <div className="journal panel">
        <b>Журнал</b>
        {view.journal.slice(-40).map((line, i) => (
          <div key={i} className="log-line">
            {line}
          </div>
        ))}
      </div>

      {view.status === 'finished' && (
        <div className="overlay">
          <div className="panel">
            <h2>{view.winners?.includes(view.me) ? 'Победа!' : 'Поражение'}</h2>
            <p className="hint">
              Причина:{' '}
              {view.finishReason === 'surrender' ? 'сдача' : view.finishReason === 'disconnect' ? 'обрыв соединения' : 'жизни на нуле'}
            </p>
            <button onClick={() => (location.href = '/')}>В меню</button>
          </div>
        </div>
      )}
    </div>
  );
}

function phaseRu(phase: string): string {
  return phase === 'main' ? 'основная' : phase === 'draw' ? 'добор' : 'бой';
}

function TimerBadge({ timer }: { timer: { running: boolean; paused: boolean; remainingMs: number; serverNowMs: number } }) {
  const [now, setNow] = useState(Date.now());
  const receivedAt = useRef(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const skew = timer.serverNowMs - receivedAt.current;
  const left = Math.max(0, timer.remainingMs - (now + skew - receivedAt.current));
  const seconds = Math.ceil(left / 1000);
  return <span className={`timer ${left < 15_000 ? 'low' : ''}`}>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>;
}

function PlayerBoard({
  view,
  pid,
  isMe,
  myMain,
  placeMode,
  pickCreature,
  pickLandscape,
  onZoneClick,
  onPickCreature,
  onPickLandscape,
  onFloop,
}: {
  view: PlayerView;
  pid: string;
  isMe: boolean;
  myMain: boolean;
  placeMode: boolean;
  pickCreature: boolean;
  pickLandscape: boolean;
  onZoneClick: (zone: number) => void;
  onPickCreature: (instanceId: string) => void;
  onPickLandscape: (playerId: string, zone: number) => void;
  onFloop: (instanceId: string) => void;
}) {
  const p = view.players[pid]!;
  const active = view.activePlayer === pid && view.status === 'running';
  return (
    <div className={`board ${isMe ? 'mine' : ''} ${active ? 'active' : ''} ${p.eliminated ? 'eliminated' : ''}`}>
      <div className="board-head">
        <b>{p.nickname}</b> <span className="hint">({heroName(p.heroId)})</span>
        <span className="lives">❤ {p.lives}</span>
        <span className="hint">
          колода {p.deckCount} · рука {p.handCount} · сброс {p.discard.length}
          {p.mulliganDecision ? ` · муллиган: ${p.mulliganDecision === 'keep' ? 'оставил' : 'перемешал'}` : ''}
        </span>
        {!p.connected && <span className="error-line">нет связи</span>}
      </div>
      <div className="zones">
        {p.zones.map((zone, i) => {
          const land = p.lands[i]!;
          return (
            <div key={i} className={`zone ${land.frozen ? 'frozen' : ''} ${land.flipped ? 'flipped' : ''}`}>
              <div
                className={`land ${pickLandscape ? 'pickable' : ''}`}
                onClick={() => pickLandscape && onPickLandscape(pid, i)}
              >
                {land.flipped ? 'перевёрнута' : land.type}
                {land.frozen ? ' ❄' : ''}
              </div>
              <div
                className={`slot ${placeMode ? 'pickable' : ''} ${zone.creature && pickCreature ? 'pickable' : ''}`}
                onClick={() => {
                  if (placeMode) onZoneClick(i);
                  else if (zone.creature && pickCreature) onPickCreature(zone.creature.instanceId);
                }}
              >
                {zone.creature ? (
                  <>
                    <CardChip card={zone.creature} />
                    {isMe && myMain && <button className="floop" onClick={(e) => { e.stopPropagation(); onFloop(zone.creature!.instanceId); }}>Флюп</button>}
                  </>
                ) : (
                  <span className="hint">{placeMode ? 'сюда' : '—'}</span>
                )}
              </div>
              <div className="slot building">
                {zone.building ? (
                  <>
                    <CardChip card={zone.building} />
                    {isMe && myMain && <button className="floop" onClick={(e) => { e.stopPropagation(); onFloop(zone.building!.instanceId); }}>Флюп</button>}
                  </>
                ) : (
                  <span className="hint">·</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {p.discard.length > 0 && (
        <div className="hint">Сброс: {p.discard.slice(-6).map((c) => cardName(c.cardId)).join(', ')}</div>
      )}
    </div>
  );
}

function CardChip({ card }: { card: CardView }) {
  return (
    <span className={`chip ${card.flipped ? 'flipped' : ''}`}>
      <b>{cardName(card.cardId)}</b>
      {(card.effAttack > 0 || card.effDefense > 0) && ` ${card.effAttack}/${card.effDefense}`}
      {card.damage > 0 && ` (урон ${card.damage})`}
      {card.shield > 0 && ` щит ${card.shield}`}
      {card.flipped && ' ↩'}
    </span>
  );
}
