import { useEffect, useMemo, useRef, useState } from 'react';
import { CONFIG, type LobbyMode, type LobbySlot } from '@card-wars/protocol';
import {
  getSelectedDeckId,
  heroName,
  loadDecks,
  saveDecks,
  setSelectedDeckId,
  toLobbyDeck,
  validateSavedDeck,
  type SavedDeck,
} from '../../decks';
import { DeckEditor } from '../../decks/DeckEditor';
import { sendLobbyCommand, useGame } from '../../store';

/** Лобби (docs/UI.md «Лобби»): слоты, колоды, готовность, настройки хоста, боты. */
export function Lobby({ code }: { code: string }) {
  const lobby = useGame((s) => s.lobby);
  const you = useGame((s) => s.you);
  const view = useGame((s) => s.view);
  const error = useGame((s) => s.error);
  const [decks, setDecks] = useState<SavedDeck[]>(() => loadDecks());
  const [selectedId, setSelectedId] = useState<string | null>(() => getSelectedDeckId());
  const [editing, setEditing] = useState<SavedDeck | null>(null);
  const [copied, setCopied] = useState(false);
  const sent = useRef<string | null>(null);

  const validDecks = useMemo(() => decks.filter((deck) => validateSavedDeck(deck).length === 0), [decks]);
  const selected = validDecks.find((deck) => deck.id === selectedId) ?? validDecks[0] ?? null;

  // Отправляем выбранную колоду на сервер при входе/смене (docs/NETWORK.md «Лобби»).
  useEffect(() => {
    if (!you || !selected || !lobby || lobby.started) return;
    const signature = `${you.playerId}:${selected.id}:${JSON.stringify(selected.cards)}:${selected.lands.join(',')}`;
    if (sent.current === signature) return;
    sent.current = signature;
    sendLobbyCommand({ type: 'set_deck', deck: toLobbyDeck(selected) });
  }, [you, selected, lobby]);

  if (!lobby || !you) {
    return (
      <div className="center-screen">
        <div className="panel menu">
          <h2>{error ? 'Не удалось войти' : 'Подключение…'}</h2>
          <p className={error ? 'error-line' : 'hint'}>{error?.message ?? 'Подключение к лобби…'}</p>
          {error && <button onClick={() => (location.href = '/')}>В меню</button>}
        </div>
      </div>
    );
  }
  if (view) return null;

  const occupied = lobby.slots.filter((slot): slot is LobbySlot => slot !== null);
  const isHost = lobby.host === you.playerId;
  const allReady = occupied.length > 0 && occupied.every((slot) => slot.ready);
  const enoughPlayers = occupied.length >= lobby.minPlayers;
  const teamsReady =
    lobby.mode.kind !== 'teams' || occupied.length === CONFIG.teamSize * 2;
  const canStart = isHost && allReady && enoughPlayers && teamsReady;

  const setMode = (value: string) => {
    const mode: LobbyMode =
      value === 'ffa'
        ? { kind: 'ffa' }
        : { kind: 'teams', variant: value === 'teams:wall' ? 'wall' : 'neighbors' };
    sendLobbyCommand({ type: 'set_mode', mode });
  };

  const modeValue =
    lobby.mode.kind === 'teams' ? `teams:${lobby.mode.variant}` : 'ffa';

  const chooseDeck = (id: string) => {
    setSelectedId(id);
    setSelectedDeckId(id);
  };

  const saveEdited = (deck: SavedDeck) => {
    const next = decks.some((d) => d.id === deck.id)
      ? decks.map((d) => (d.id === deck.id ? deck : d))
      : [...decks, deck];
    setDecks(next);
    saveDecks(next);
    chooseDeck(deck.id);
    setEditing(null);
  };

  const move = (playerId: string, seat: number) => {
    if (seat < 0 || seat >= CONFIG.maxPlayers) return;
    sendLobbyCommand({ type: 'move_player', player: playerId, seat });
  };

  if (editing) {
    return (
      <div className="screen">
        <DeckEditor deck={editing} onSave={saveEdited} onClose={() => setEditing(null)} />
      </div>
    );
  }

  return (
    <div className="screen lobby-screen">
      <header className="screen-head">
        <h1>Лобби {code}</h1>
        <button
          className="mini"
          onClick={() => {
            navigator.clipboard?.writeText(`${location.origin}/play/${code}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}
        </button>
        <button
          className="mini"
          onClick={() => {
            sendLobbyCommand({ type: 'leave' });
            location.href = '/';
          }}
        >
          Выйти
        </button>
      </header>

      {error && <div className="error-line">{error.message}</div>}

      <div className="lobby-settings panel">
        <label>
          Режим:{' '}
          <select value={modeValue} disabled={!isHost} onChange={(e) => setMode(e.target.value)}>
            <option value="ffa">каждый сам за себя (2–4)</option>
            <option value="teams:neighbors">2 на 2 — соседи</option>
            <option value="teams:wall">2 на 2 — стенка на стенку</option>
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={lobby.hidden}
            disabled={!isHost}
            onChange={(e) => sendLobbyCommand({ type: 'set_hidden', hidden: e.target.checked })}
          />
          скрывать составы
        </label>
        <span className="hint">
          {occupied.length} / {lobby.maxPlayers} игроков · {allReady ? 'все готовы' : 'не все готовы'}
        </span>
      </div>

      <div className="lobby-slots">
        {lobby.slots.map((slot, seat) => (
          <div
            key={seat}
            className={`lobby-slot panel ${slot?.id === you.playerId ? 'me' : ''} ${slot ? '' : 'empty'}`}
            draggable={isHost && Boolean(slot)}
            onDragStart={(e) => {
              if (slot) e.dataTransfer.setData('text/plain', slot.id);
            }}
            onDragOver={(e) => {
              if (isHost) e.preventDefault();
            }}
            onDrop={(e) => {
              if (!isHost) return;
              e.preventDefault();
              const playerId = e.dataTransfer.getData('text/plain');
              if (playerId) move(playerId, seat);
            }}
          >
            <div className="lobby-slot-head">
              <b>Место {seat + 1}</b>
              {slot?.id === lobby.host && <span className="badge">хост</span>}
              {slot?.isBot && <span className="badge bot">бот</span>}
              {slot && !slot.connected && <span className="hint">нет связи</span>}
            </div>

            {slot ? (
              <>
                <div className="lobby-name">{slot.nickname}</div>
                <div className="hint">
                  {slot.deck
                    ? `${heroName(slot.deck.heroId)} · ${slot.deck.cards.length} карт`
                    : 'колода скрыта'}
                </div>
                <div className={slot.ready ? 'ready-ok' : 'hint'}>
                  {slot.ready ? 'готов' : 'не готов'}
                </div>

                {slot.id === you.playerId && (
                  <div className="lobby-self">
                    <select value={selected?.id ?? ''} onChange={(e) => chooseDeck(e.target.value)}>
                      {validDecks.map((deck) => (
                        <option key={deck.id} value={deck.id}>
                          {deck.name} · {heroName(deck.heroId)}
                        </option>
                      ))}
                    </select>
                    <div className="row">
                      <button
                        className="mini"
                        onClick={() => {
                          const deck = validDecks.find((d) => d.id === selectedId) ?? validDecks[0];
                          if (deck) setEditing(deck);
                        }}
                      >
                        Редактировать
                      </button>
                      <button className="mini" onClick={() => sendLobbyCommand({ type: 'ready', ready: !slot.ready })}>
                        {slot.ready ? 'Не готов' : 'Готов'}
                      </button>
                    </div>
                    {validDecks.length === 0 && <div className="error-line">Нужна готовая колода</div>}
                  </div>
                )}

                {isHost && slot.id !== you.playerId && (
                  <div className="deck-card-actions">
                    {slot.isBot ? (
                      <button className="mini" onClick={() => sendLobbyCommand({ type: 'remove_bot', player: slot.id })}>
                        Убрать бота
                      </button>
                    ) : (
                      <>
                        <button className="mini" onClick={() => sendLobbyCommand({ type: 'kick', player: slot.id })}>
                          Кикнуть
                        </button>
                        {slot.connected && (
                          <button
                            className="mini"
                            onClick={() => sendLobbyCommand({ type: 'transfer_host', player: slot.id })}
                          >
                            Сделать хостом
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}

                {isHost && (
                  <div className="seat-move">
                    <button className="mini" disabled={seat === 0} onClick={() => move(slot.id, seat - 1)}>
                      ◀
                    </button>
                    <button
                      className="mini"
                      disabled={seat === lobby.maxPlayers - 1}
                      onClick={() => move(slot.id, seat + 1)}
                    >
                      ▶
                    </button>
                    <span className="hint">пересадка</span>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="hint">Свободно</div>
                {isHost && (
                  <button className="mini" onClick={() => sendLobbyCommand({ type: 'add_bot' })}>
                    Добавить бота
                  </button>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {isHost ? (
        <div className="lobby-start">
          <button disabled={!canStart} onClick={() => sendLobbyCommand({ type: 'start' })}>
            Начать матч
          </button>
          {!canStart && (
            <span className="hint">
              {!enoughPlayers
                ? `Нужно минимум ${lobby.minPlayers} игрока`
                : !allReady
                  ? 'Все должны быть готовы'
                  : !teamsReady
                    ? `Для 2 на 2 нужно ровно ${CONFIG.teamSize * 2} игрока`
                    : ''}
            </span>
          )}
        </div>
      ) : (
        <p className="hint">Ждём, когда хост начнёт матч…</p>
      )}
    </div>
  );
}
