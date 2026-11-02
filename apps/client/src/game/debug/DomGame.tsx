import { cards as contentCards, heroes } from '@card-wars/content';
import type { CardView } from '@card-wars/protocol';
import { sendCommand, setUi, useGame } from '../../store';
import { heroNameOf } from '../hud/names';

const cardName = (cardId: string): string => contentCards.find((c) => c.id === cardId)?.name ?? cardId;
const cardMeta = (cardId: string) => contentCards.find((c) => c.id === cardId);

/** DOM-отладочный вид этапа 2 (?debug=1): плоские таблицы зон, быстрый клик-флоу. */
export function DomGame({ code }: { code: string }) {
  const view = useGame((s) => s.view)!;
  const error = useGame((s) => s.error);
  const selected = useGame((s) => s.ui.selectedHand);

  const me = view.players[view.me]!;
  const myTurn = view.activePlayers.includes(view.me) && view.status === 'running';
  const myMain = myTurn && view.phase === 'main';
  const activeNames = view.activePlayers.map((pid) => view.players[pid]?.nickname ?? pid).join(', ');
  const selectedMeta = selected ? cardMeta(view.myHand.find((c) => c.instanceId === selected)?.cardId ?? '') : undefined;

  const send = (command: Parameters<typeof sendCommand>[0]) => {
    sendCommand(command);
  };

  const playToZone = (zone: number) => {
    if (!selected) return;
    send({ type: 'play_card', player: view.me, instanceId: selected, zone });
    setUi({ selectedHand: null });
  };

  return (
    <div className="game">
      <header>
        <b>DEBUG · Комната {code}</b> — круг {view.round}, ход {view.turn}, фаза {view.phase}, сейчас: {activeNames}
      </header>
      <div className="boards">
        {[...view.order].reverse().map((pid) => (
          <DebugBoard key={pid} pid={pid} placeMode={Boolean(selected) && selectedMeta?.type !== 'spell'} onZone={playToZone} />
        ))}
      </div>
      <div className="actions">
        {myMain && (
          <>
            <button onClick={() => send({ type: 'go_battle', player: view.me })}>В бой</button>
            <button disabled={me.actions < 1} onClick={() => send({ type: 'draw_extra', player: view.me })}>
              Добор
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
      <div className="hand panel">
        <b>Рука</b> ({me.handCount}) — действий: {me.actions}
        <div className="cards-row">
          {view.myHand.map(({ instanceId, cardId }) => {
            const meta = cardMeta(cardId);
            return (
              <div
                key={instanceId}
                className={`card ${selected === instanceId ? 'selected' : ''}`}
                title={meta?.description || undefined}
                onClick={() => setUi({ selectedHand: selected === instanceId ? null : instanceId })}
              >
                <b>{cardName(cardId)}</b>
                <span className="hint">
                  {meta?.type === 'creature' ? `${meta.attack}/${meta.defense}` : meta?.type} · {meta?.cost}д
                </span>
                {selected === instanceId && (
                  <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                    {meta?.type === 'spell' ? (
                      <button onClick={() => send({ type: 'play_card', player: view.me, instanceId })}>Разыграть</button>
                    ) : (
                      <span className="hint">кликни зону</span>
                    )}
                    <button onClick={() => send({ type: 'discard_from_hand', player: view.me, instanceId })}>Сброс</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {error && <div className="error-line">{error.message}</div>}
      <div className="journal panel">
        {view.journal.slice(-30).map((line, i) => (
          <div key={i} className="log-line">{line}</div>
        ))}
      </div>
    </div>
  );
}

function DebugBoard({
  pid,
  placeMode,
  onZone,
}: {
  pid: string;
  placeMode: boolean;
  onZone: (zone: number) => void;
}) {
  const view = useGame((s) => s.view)!;
  const p = view.players[pid]!;
  const isMe = pid === view.me;
  const myMain = view.activePlayers.includes(view.me) && view.status === 'running' && view.phase === 'main';
  return (
    <div className={`board ${isMe ? 'mine' : ''} ${view.activePlayers.includes(pid) ? 'active' : ''}`}>
      <div className="board-head">
        <b>{p.nickname}</b> <span className="hint">({heroNameOf(p.heroId)})</span> <span className="lives">❤ {p.lives}</span>
        <span className="hint">колода {p.deckCount} · рука {p.handCount} · сброс {p.discard.length}</span>
        {!p.connected && <span className="error-line">нет связи</span>}
      </div>
      <div className="zones">
        {p.zones.map((zone, i) => (
          <div key={i} className={`zone ${p.lands[i]!.frozen ? 'frozen' : ''}`}>
            <div className="land">
              {p.lands[i]!.flipped ? '?' : p.lands[i]!.type}
              {p.lands[i]!.frozen ? ' ❄' : ''}
            </div>
            <div
              className={`slot ${placeMode && isMe ? 'pickable' : ''}`}
              onClick={() => {
                if (placeMode && isMe) onZone(i);
              }}
            >
              {zone.creature ? <Chip card={zone.creature} /> : <span className="hint">{placeMode && isMe ? 'сюда' : '—'}</span>}
            </div>
            <div className="slot building">
              {zone.building ? <Chip card={zone.building} /> : <span className="hint">·</span>}
              {zone.building && isMe && myMain && (
                <button className="floop" onClick={() => sendCommand({ type: 'floop', player: view.me, instanceId: zone.building!.instanceId })}>Флюп</button>
              )}
            </div>
            {zone.creature && isMe && myMain && (
              <button className="floop" onClick={() => sendCommand({ type: 'floop', player: view.me, instanceId: zone.creature!.instanceId })}>Флюп</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Chip({ card }: { card: CardView }) {
  return (
    <span className={`chip ${card.flipped ? 'flipped' : ''}`} title={cardMeta(card.cardId)?.description || undefined}>
      <b>{cardName(card.cardId)}</b> {card.effAttack}/{card.effDefense}
      {card.damage > 0 ? ` (урон ${card.damage})` : ''}
      {card.shield > 0 ? ` щит ${card.shield}` : ''}
      {card.flipped ? ' ↩' : ''}
    </span>
  );
}

void heroes;
