import { useEffect, useMemo, useRef, useState } from 'react';
import { CONFIG, type LobbyMode, type LobbySlot } from '@card-wars/protocol';
import {
  getSelectedDeckId,
  heroName,
  loadDecks,
  newDeck,
  saveDecks,
  setSelectedDeckId,
  toLobbyDeck,
  validateSavedDeck,
  type SavedDeck,
} from '../../decks';
import { DeckEditor } from '../../decks/DeckEditor';
import { sendLobbyCommand, useGame } from '../../store';

/** Лобби (docs/UI.md «Лобби»): код, колода, игроки, настройки хоста, боты. */
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

  useEffect(() => {
    if (!you || !selected || !lobby || lobby.started) return;
    const signature = `${you.playerId}:${selected.id}:${JSON.stringify(selected.cards)}:${selected.lands.join(',')}`;
    if (sent.current === signature) return;
    sent.current = signature;
    sendLobbyCommand({ type: 'set_deck', deck: toLobbyDeck(selected) });
  }, [you, selected, lobby]);

  if (!lobby || !you) {
    return (
      <main className="main-menu ui-v2">
        <div className="main-menu-content">
          <span className="eyebrow">Card Wars</span>
          <h1>{error ? 'Не удалось войти' : 'Подключение…'}</h1>
          <p className={error ? 'lobby-error' : 'main-menu-subtitle'}>
            {error?.message ?? 'Подключаемся к лобби'}
          </p>
          {error && (
            <button className="btn-primary btn-xl" onClick={() => (location.href = '/')}>
              В меню
            </button>
          )}
        </div>
      </main>
    );
  }
  if (view) return null;
  if (lobby.started) {
    return (
      <main className="main-menu ui-v2">
        <div className="main-menu-content">
          <span className="eyebrow">Card Wars</span>
          <h1>Матч начинается…</h1>
        </div>
      </main>
    );
  }

  const occupied = lobby.slots.filter((slot): slot is LobbySlot => slot !== null);
  const isHost = lobby.host === you.playerId;
  const meSlot = lobby.slots.find((slot) => slot?.id === you.playerId) ?? null;
  const allReady = occupied.length > 0 && occupied.every((slot) => slot.ready);
  const enoughPlayers = occupied.length >= lobby.minPlayers;
  const teamsReady = lobby.mode.kind !== 'teams' || occupied.length === CONFIG.teamSize * 2;
  const allConnected = occupied.every((slot) => slot.isBot || slot.connected);
  const canStart = isHost && allReady && enoughPlayers && teamsReady && allConnected;

  const setMode = (value: string) => {
    const mode: LobbyMode =
      value === 'ffa'
        ? { kind: 'ffa' }
        : { kind: 'teams', variant: value === 'teams:wall' ? 'wall' : 'neighbors' };
    sendLobbyCommand({ type: 'set_mode', mode });
  };

  const modeValue = lobby.mode.kind === 'teams' ? `teams:${lobby.mode.variant}` : 'ffa';
  const modeLabel =
    lobby.mode.kind === 'teams'
      ? lobby.mode.variant === 'wall'
        ? '2 на 2 — стенка на стенку'
        : '2 на 2 — соседи'
      : 'каждый сам за себя';

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
    return <DeckEditor deck={editing} onSave={saveEdited} onClose={() => setEditing(null)} />;
  }

  return (
    <main className="lobby-room ui-v2">
      <div className="lobby-room-content">
        <div className="lobby-topbar">
          <button className="back-btn" onClick={() => {
            sendLobbyCommand({ type: 'leave' });
            location.href = '/';
          }}>
            ← Выйти из лобби
          </button>
          <span className="lobby-topbar-status">
            {occupied.length}/{lobby.maxPlayers} игроков
          </span>
        </div>

        <div className="lobby-title">
          <span className="eyebrow">Card Wars · онлайн</span>
          <h1>Лобби</h1>
        </div>

        {error && <div className="lobby-error">{error.message}</div>}

        <section className="lobby-code-display">
          <span className="lobby-code-label">Код комнаты</span>
          <div className="lobby-code-value">
            <span>{code}</span>
            <button
              className="lobby-copy-btn"
              title="Скопировать ссылку"
              onClick={() => {
                navigator.clipboard?.writeText(`${location.origin}/play/${code}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? '✓' : '⧉'}
            </button>
          </div>
          <p className="lobby-code-hint">Поделитесь кодом с другом или отправьте ссылку</p>
        </section>

        <section className="lobby-deck-picker">
          <div className="lobby-deck-picker__label">Ваша колода</div>
          {validDecks.length > 0 ? (
            <>
              <div className="lobby-deck-picker__row">
                <select value={selected?.id ?? ''} onChange={(e) => chooseDeck(e.target.value)}>
                  {validDecks.map((deck) => (
                    <option key={deck.id} value={deck.id}>
                      {deck.name} · {heroName(deck.heroId)}
                    </option>
                  ))}
                </select>
                <button
                  className="btn-soft"
                  onClick={() => {
                    const deck = validDecks.find((d) => d.id === selectedId) ?? validDecks[0];
                    if (deck) setEditing(deck);
                  }}
                >
                  Редактировать
                </button>
              </div>
              {selected && (
                <p className="hint">
                  {heroName(selected.heroId)} · {selected.cards.length}/{CONFIG.deckSize} карт · земли:{' '}
                  {selected.lands.join(', ')}
                </p>
              )}
            </>
          ) : (
            <div className="lobby-deck-picker__empty">
              <p className="hint">Нет готовой колоды — соберите 40 карт и выберите героя.</p>
              <button className="btn-accent" onClick={() => setEditing(newDeck())}>
                Собрать колоду
              </button>
            </div>
          )}
        </section>

        <section className="lobby-players">
          <div className="lobby-section-head">
            <h2>Игроки</h2>
            <span className="hint">слоты = порядок хода</span>
          </div>
          <ul className="lobby-players__list">
            {lobby.slots.map((slot, seat) => (
              <li
                key={seat}
                className={`lobby-player ${slot ? '' : 'lobby-player--empty'}`}
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
                <div className="lobby-player__info">
                  <div className="lobby-player__name">
                    <span className={`status-dot ${slot?.connected ? 'on' : ''}`} />
                    {slot?.id === lobby.host && (
                      <span className="host-mark" title="Хост">
                        ♛
                      </span>
                    )}
                    <span>{slot?.nickname ?? 'Свободное место'}</span>
                    {slot?.id === you.playerId && <span className="you-mark">(вы)</span>}
                    {slot?.isBot && <span className="bot-mark">бот</span>}
                  </div>
                  <div className={`lobby-player__deck ${slot?.deck ? 'ok' : ''}`}>
                    {slot
                      ? slot.deck
                        ? `${heroName(slot.deck.heroId)} · ${slot.deck.cards.length} карт`
                        : 'колода скрыта'
                      : '—'}
                  </div>
                </div>

                <span className={`lobby-player__status ${slot?.ready ? 'ready' : 'waiting'}`}>
                  {slot ? (slot.ready ? '✓ Готов' : 'Ожидание') : '—'}
                </span>

                {isHost && slot && (
                  <div className="lobby-row-actions">
                    {slot.id !== you.playerId &&
                      (slot.isBot ? (
                        <button className="mini" onClick={() => sendLobbyCommand({ type: 'remove_bot', player: slot.id })}>
                          Убрать
                        </button>
                      ) : (
                        <>
                          <button className="mini" onClick={() => sendLobbyCommand({ type: 'kick', player: slot.id })}>
                            Кикнуть
                          </button>
                          {slot.connected && (
                            <button className="mini" onClick={() => sendLobbyCommand({ type: 'transfer_host', player: slot.id })}>
                              Хост
                            </button>
                          )}
                        </>
                      ))}
                    <button className="mini" disabled={seat === 0} onClick={() => move(slot.id, seat - 1)} aria-label="Пересадить влево">
                      ◀
                    </button>
                    <button
                      className="mini"
                      disabled={seat === lobby.maxPlayers - 1}
                      onClick={() => move(slot.id, seat + 1)}
                      aria-label="Пересадить вправо"
                    >
                      ▶
                    </button>
                  </div>
                )}

                {isHost && !slot && (
                  <button className="btn-soft btn-small" onClick={() => sendLobbyCommand({ type: 'add_bot' })}>
                    + Бот
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        {isHost ? (
          <section className="lobby-settings">
            <div className="lobby-section-head">
              <h2>Настройки комнаты</h2>
            </div>
            <label className="field">
              <span className="field-label">Режим</span>
              <select value={modeValue} onChange={(e) => setMode(e.target.value)}>
                <option value="ffa">каждый сам за себя (2–4)</option>
                <option value="teams:neighbors">2 на 2 — соседи</option>
                <option value="teams:wall">2 на 2 — стенка на стенку</option>
              </select>
            </label>
            <label className="filter-check">
              <input
                type="checkbox"
                checked={lobby.hidden}
                onChange={(e) => sendLobbyCommand({ type: 'set_hidden', hidden: e.target.checked })}
              />
              скрывать составы игроков
            </label>
          </section>
        ) : (
          <p className="lobby-hint">
            Режим: {modeLabel} · {lobby.hidden ? 'составы скрыты' : 'составы видны'}
          </p>
        )}

        <div className="lobby-actions">
          <button
            className={`btn-ready ${meSlot?.ready ? 'done' : ''}`}
            disabled={!meSlot || validDecks.length === 0}
            onClick={() => sendLobbyCommand({ type: 'ready', ready: !meSlot?.ready })}
          >
            {meSlot?.ready ? '✓ Вы готовы' : 'Готов'}
          </button>
          {isHost && (
            <button className="btn-primary btn-xl" disabled={!canStart} onClick={() => sendLobbyCommand({ type: 'start' })}>
              Начать матч
            </button>
          )}
        </div>

        {isHost && !canStart && (
          <p className="lobby-hint">
            {!enoughPlayers
              ? `Нужно минимум ${lobby.minPlayers} игрока`
              : !allConnected
                ? 'Не все игроки в сети'
                : !allReady
                  ? 'Все должны быть готовы'
                  : !teamsReady
                    ? `Для 2 на 2 нужно ровно ${CONFIG.teamSize * 2} игрока`
                    : ''}
          </p>
        )}
      </div>
    </main>
  );
}
