import { useEffect, useMemo, useRef, useState } from 'react';
import { CONFIG, type LobbyMode, type LobbySlot } from '@card-wars/protocol';
import {
  getHero,
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
import { DeckEditor, clearEditorDraft, loadEditorDraft } from '../../decks/DeckEditor';
import { DeckPreview } from '../../decks/DeckPreview';
import { sendLobbyCommand, useGame } from '../../store';
import { soundEngine } from '../../sound/SoundEngine';

const LOBBY_EDITOR_DRAFT_KEY = 'cw-lobby-editor-draft';

/** Лобби (docs/UI.md «Лобби»): код, колода, игроки, настройки хоста, боты. */
export function Lobby({ code }: { code: string }) {
  const lobby = useGame((s) => s.lobby);
  const you = useGame((s) => s.you);
  const view = useGame((s) => s.view);
  const error = useGame((s) => s.error);
  const [decks, setDecks] = useState<SavedDeck[]>(() => loadDecks());
  const [selectedId, setSelectedId] = useState<string | null>(() => getSelectedDeckId());
  const [editing, setEditing] = useState<SavedDeck | null>(() => loadEditorDraft(LOBBY_EDITOR_DRAFT_KEY));
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [previewSeat, setPreviewSeat] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const sent = useRef<string | null>(null);
  const previewDialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    if (error) soundEngine.playError();
  }, [error]);

  useEffect(() => {
    const dialog = previewDialogRef.current;
    if (!dialog) return;
    if (previewSeat !== null && lobby?.slots[previewSeat]?.deck) {
      if (!dialog.open) {
        soundEngine.playModalOpen();
        dialog.showModal();
      }
    } else if (dialog.open) {
      soundEngine.playModalClose();
      dialog.close();
    }
  }, [previewSeat, lobby]);

  const validDecks = useMemo(() => decks.filter((deck) => validateSavedDeck(deck).length === 0), [decks]);
  const selected = validDecks.find((deck) => deck.id === selectedId) ?? validDecks[0] ?? null;

  useEffect(() => {
    if (!you || !selected || !lobby || lobby.started) return;
    const signature = `${you.playerId}:${selected.id}:${JSON.stringify(selected.cards)}:${selected.lands.join(',')}:${selected.landIds?.join(',') ?? ''}`;
    if (sent.current === signature) return;
    sent.current = signature;
    sendLobbyCommand({ type: 'set_deck', deck: toLobbyDeck(selected) });
  }, [you, selected, lobby]);

  if (!lobby || !you) {
    return (
      <main className="main-menu ui-v2">
        <div className="main-menu-content">
          <div className="main-menu-panel cw-felt-box">
            <span className="eyebrow">Card Wars</span>
            <h1>{error ? 'Не удалось войти' : 'Подключение…'}</h1>
            <p className={error ? 'lobby-error' : 'main-menu-subtitle'}>
              {error?.message ?? 'Подключаемся к лобби'}
            </p>
            {error && (
              <button type="button" className="cw-btn-3d btn-dark btn-lg" onClick={() => (location.href = '/')}>
                В меню
              </button>
            )}
          </div>
        </div>
      </main>
    );
  }
  if (view) return null;
  if (lobby.started) {
    return (
      <main className="main-menu ui-v2">
        <div className="main-menu-content">
          <div className="main-menu-panel cw-felt-box">
            <span className="eyebrow">Card Wars</span>
            <h1>Матч начинается…</h1>
          </div>
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
    soundEngine.playButtonClick();
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
    soundEngine.playCardDraw();
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
    clearEditorDraft(LOBBY_EDITOR_DRAFT_KEY);
    setEditing(null);
  };

  const move = (playerId: string, seat: number) => {
    if (seat < 0 || seat >= CONFIG.maxPlayers) return;
    soundEngine.playCardPlay();
    sendLobbyCommand({ type: 'move_player', player: playerId, seat });
  };

  if (editing) {
    return (
      <DeckEditor
        deck={editing}
        storageKey={LOBBY_EDITOR_DRAFT_KEY}
        onSave={saveEdited}
        onClose={() => {
          clearEditorDraft(LOBBY_EDITOR_DRAFT_KEY);
          setEditing(null);
        }}
      />
    );
  }

  return (
    <main className="lobby-room ui-v2">
      <div className="lobby-shell">
        <div className="lobby-topbar">
          <button
            type="button"
            className="cw-btn-3d btn-dark lobby-topbar-pill"
            onClick={() => {
              sendLobbyCommand({ type: 'leave' });
              location.href = '/';
            }}
          >
            ← Выйти из лобби
          </button>

          <span className="lobby-topbar-status cw-felt-box lobby-topbar-pill">
            {occupied.length}/{lobby.maxPlayers} игроков
          </span>

          <div className="lobby-code-pill cw-felt-box lobby-topbar-pill">
            <span className="lobby-code-pill__label">Код:</span>
            <strong className="lobby-code-pill__val">{code}</strong>
            <button
              type="button"
              className="cw-btn-3d btn-gold btn-sm"
              title="Скопировать ссылку"
              aria-label="Скопировать ссылку"
              onClick={() => {
                soundEngine.playButtonClick();
                navigator.clipboard?.writeText(`${location.origin}/play/${code}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? '✓' : '⧉'}
            </button>
          </div>
        </div>

        {/* LEFT COLUMN: Mode-Aware Arena */}
        <div className="lobby-main-col">
          {error && <div className="lobby-error">{error.message}</div>}

          <section
            className={`lobby-arena cw-felt-box lobby-arena--${
              lobby.mode.kind === 'teams' ? lobby.mode.variant : 'ffa'
            }`}
            aria-label="Рассадка игроков"
          >
            {/* Center battle map explaining who fights whom */}
            <div className="lobby-battle-map cw-paper-box">
              {lobby.mode.kind === 'ffa' ? (
                <>
                  <span className="lobby-battle-map__badge">⚔️ Каждый сам за себя</span>
                  <p className="lobby-battle-map__desc">
                    {occupied.length <= 2
                      ? 'Дуэль 1 на 1: игроки стоят лицом друг к другу'
                      : 'Угловые места: левое крыло бьёт соседа слева, правое — соседа справа'}
                  </p>
                </>
              ) : lobby.mode.variant === 'neighbors' ? (
                <>
                  <span className="lobby-battle-map__badge">🤝 2 на 2 — Соседи</span>
                  <p className="lobby-battle-map__desc">
                    Союзник сидит <strong>напротив</strong> (#1 ↔ #3 и #2 ↔ #4), противники — слева и справа
                  </p>
                </>
              ) : (
                <>
                  <span className="lobby-battle-map__badge">🛡️ 2 на 2 — Стенка на стенку</span>
                  <p className="lobby-battle-map__desc">
                    Союзник <strong>рядом</strong> (#1 + #2 снизу против #3 + #4 сверху) — общий ряд из 8 зон
                  </p>
                </>
              )}
            </div>

            <ul
              className={`lobby-players__list lobby-players__list--${
                lobby.mode.kind === 'teams' ? lobby.mode.variant : 'ffa'
              }`}
            >
              {lobby.slots.map((slot, seat) => {
                const isMe = slot?.id === you.playerId;
                const isSeatSelected = selectedSeat === seat;
                const hero = slot?.deck ? getHero(slot.deck.heroId) : null;
                const teamTag =
                  lobby.mode.kind === 'teams'
                    ? lobby.mode.variant === 'wall'
                      ? seat < 2
                        ? 'A'
                        : 'B'
                      : seat % 2 === 0
                        ? 'A'
                        : 'B'
                    : null;

                return (
                  <li
                    key={`${seat}-${slot?.id ?? 'empty'}`}
                    className={`lobby-player lobby-seat-${seat} ${slot ? '' : 'lobby-player--empty'} ${
                      isMe ? 'lobby-player--me' : ''
                    } ${teamTag ? `lobby-player--team-${teamTag}` : ''} ${
                      isSeatSelected ? 'is-selected-seat' : ''
                    }`}
                    draggable={isHost && Boolean(slot)}
                    onDragStart={(e) => {
                      if ((e.target as HTMLElement).closest('select, button, input')) {
                        e.preventDefault();
                        return;
                      }
                      setPreviewSeat(null);
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
                    <div className="lobby-player-head">
                      <div className="lobby-seat-badge" title={`Место за столом №${seat + 1}`}>
                        #{seat + 1}
                      </div>
                      {teamTag && (
                        <span className={`lobby-team-pill lobby-team-pill--${teamTag}`}>
                          Команда {teamTag}
                        </span>
                      )}
                      <span className={`lobby-seal-stamp ${slot ? (slot.ready ? 'is-ready' : 'is-waiting') : 'is-empty'}`}>
                        {slot ? (slot.ready ? '✓ Готов' : 'Ждёт') : 'Свободно'}
                      </span>
                    </div>

                    <div className="lobby-player-main">
                      <div className="lobby-player__avatar">
                        {hero?.image ? (
                          <img src={hero.image} alt={hero.name} className="lobby-hero-avatar-img" />
                        ) : (
                          <div className={`lobby-hero-avatar-fallback ${slot ? 'is-occupied' : 'is-empty'}`}>
                            {slot ? (slot.isBot ? '🤖' : '⚔️') : '🪑'}
                          </div>
                        )}
                      </div>

                      <div className="lobby-player__info">
                        <div className="lobby-player__name">
                          <span className={`status-dot ${slot?.connected ? 'on' : ''}`} />
                          {slot?.id === lobby.host && (
                            <span className="host-mark" title="Хост">
                              ♛
                            </span>
                          )}
                          <span>{slot?.nickname ?? 'Свободное место'}</span>
                          {isMe && <span className="you-mark">(вы)</span>}
                          {slot?.isBot && <span className="bot-mark">бот</span>}
                        </div>
                        <div
                          className={`lobby-player__deck ${slot?.deck ? 'ok clickable' : ''}`}
                          onClick={(e) => {
                            if (slot?.deck) {
                              e.stopPropagation();
                              soundEngine.playCardDraw();
                              setPreviewSeat((cur) => (cur === seat ? null : seat));
                            }
                          }}
                          onKeyDown={(e) => {
                            if (slot?.deck && (e.key === 'Enter' || e.key === ' ')) {
                              e.preventDefault();
                              e.stopPropagation();
                              soundEngine.playCardDraw();
                              setPreviewSeat((cur) => (cur === seat ? null : seat));
                            }
                          }}
                          role={slot?.deck ? 'button' : undefined}
                          tabIndex={slot?.deck ? 0 : undefined}
                          title={slot?.deck ? 'Нажмите для просмотра колоды' : undefined}
                        >
                          {slot
                            ? slot.deck
                              ? `${heroName(slot.deck.heroId)} · ${slot.deck.cards.length} карт 👁️`
                              : 'колода скрыта'
                            : 'Перетащите игрока сюда'}
                        </div>
                      </div>
                    </div>

                    {isMe && (
                      <div
                        className="lobby-my-deck-bar"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {validDecks.length > 0 ? (
                          <div className="lobby-my-deck-bar__row">
                            <select
                              aria-label="Выбор колоды"
                              value={selected?.id ?? ''}
                              onChange={(e) => chooseDeck(e.target.value)}
                            >
                              {validDecks.map((deck) => (
                                <option key={deck.id} value={deck.id}>
                                  {deck.name} · {heroName(deck.heroId)}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="cw-btn-3d btn-blue btn-sm"
                              onClick={() => {
                                const deck = validDecks.find((d) => d.id === selectedId) ?? validDecks[0];
                                if (deck) setEditing(deck);
                              }}
                            >
                              Изменить
                            </button>
                          </div>
                        ) : (
                          <div className="lobby-my-deck-bar__row">
                            <span className="hint">Нет готовой колоды (40 карт)</span>
                            <button
                              type="button"
                              className="cw-btn-3d btn-green btn-sm"
                              onClick={() => setEditing(newDeck())}
                            >
                              Собрать
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {isHost && slot && (
                      <div className="lobby-row-actions">
                        {slot.id !== you.playerId &&
                          (slot.isBot ? (
                            <button
                              type="button"
                              className="cw-btn-3d btn-red btn-sm"
                              onClick={() => {
                                soundEngine.playButtonClick();
                                sendLobbyCommand({ type: 'remove_bot', player: slot.id });
                              }}
                            >
                              Убрать
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="cw-btn-3d btn-red btn-sm"
                                onClick={() => {
                                  soundEngine.playButtonClick();
                                  sendLobbyCommand({ type: 'kick', player: slot.id });
                                }}
                              >
                                Кикнуть
                              </button>
                              {slot.connected && (
                                <button
                                  type="button"
                                  className="cw-btn-3d btn-purple btn-sm"
                                  onClick={() => {
                                    soundEngine.playButtonClick();
                                    sendLobbyCommand({ type: 'transfer_host', player: slot.id });
                                  }}
                                >
                                  Хост
                                </button>
                              )}
                            </>
                          ))}
                        {selectedSeat !== null && selectedSeat !== seat ? (
                          <button
                            type="button"
                            className="cw-btn-3d btn-orange btn-sm"
                            onClick={() => {
                              soundEngine.playButtonClick();
                              const source = lobby.slots[selectedSeat];
                              if (source) move(source.id, seat);
                              setSelectedSeat(null);
                            }}
                            title="Поменять местами с выбранным"
                          >
                            ⇄ Сюда
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={`cw-btn-3d ${isSeatSelected ? 'btn-red' : 'btn-orange'} btn-sm`}
                            onClick={() => {
                              soundEngine.playButtonClick();
                              setSelectedSeat((cur) => (cur === seat ? null : seat));
                            }}
                            title="Выбрать игрока для пересадки"
                            aria-label="Выбрать для пересадки"
                          >
                            {isSeatSelected ? '✕ Отмена' : '⇅ Пересадить'}
                          </button>
                        )}
                      </div>
                    )}

                    {isHost && !slot && selectedSeat !== null && (
                      <button
                        type="button"
                        className="cw-btn-3d btn-orange btn-sm"
                        onClick={() => {
                          soundEngine.playButtonClick();
                          const source = lobby.slots[selectedSeat];
                          if (source) move(source.id, seat);
                          setSelectedSeat(null);
                        }}
                      >
                        ↵ Пересадить сюда
                      </button>
                    )}

                    {isHost && !slot && selectedSeat === null && (
                      <button
                        type="button"
                        className="cw-btn-3d btn-blue btn-sm"
                        onClick={() => {
                          soundEngine.playButtonClick();
                          sendLobbyCommand({ type: 'add_bot' });
                        }}
                      >
                        + Бот
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        {/* RIGHT SIDEBAR: Settings & Match Launch */}
        <aside className="lobby-sidebar cw-felt-box">
          <div className="lobby-sidebar-head">
            <span className="eyebrow menu-eyebrow">Комната {code}</span>
            <h1 className="cw-ink-title">Лобби</h1>
          </div>

          {isHost ? (
            <section className="lobby-settings cw-paper-box">
              <h2 className="cw-ink-title">Настройки матча</h2>
              <label className="field">
                <span className="field-label">Режим</span>
                <select value={modeValue} onChange={(e) => setMode(e.target.value)}>
                  <option value="ffa">Каждый сам за себя (2–4)</option>
                  <option value="teams:neighbors">2 на 2 — соседи</option>
                  <option value="teams:wall">2 на 2 — стенка на стенку</option>
                </select>
              </label>
              <label className="filter-check">
                <input
                  type="checkbox"
                  checked={lobby.hidden}
                  onChange={(e) => {
                    soundEngine.playButtonClick();
                    sendLobbyCommand({ type: 'set_hidden', hidden: e.target.checked });
                  }}
                />
                Скрывать составы игроков
              </label>
              <label className="filter-check">
                <input
                  type="checkbox"
                  checked={Boolean(lobby.anyLand)}
                  onChange={(e) => {
                    soundEngine.playButtonClick();
                    sendLobbyCommand({ type: 'set_any_land', anyLand: e.target.checked });
                  }}
                />
                Любые земли для карт
              </label>
            </section>
          ) : (
            <section className="lobby-settings cw-paper-box">
              <h2 className="cw-ink-title">Параметры матча</h2>
              <p className="lobby-mode-summary">
                <strong>Режим:</strong> {modeLabel}
              </p>
              <p className="lobby-mode-summary">
                <strong>Составы:</strong> {lobby.hidden ? 'скрыты' : 'видны'}
              </p>
              <p className="lobby-mode-summary">
                <strong>Земли:</strong> {lobby.anyLand ? 'любые' : 'по правилам'}
              </p>
            </section>
          )}

          <div className="lobby-sidebar-actions">
            <button
              type="button"
              className={`cw-btn-3d ${meSlot?.ready ? 'btn-green done' : 'btn-orange'} btn-lg btn-block`}
              disabled={!meSlot || validDecks.length === 0}
              onClick={() => {
                const next = !meSlot?.ready;
                if (next) soundEngine.playGong();
                else soundEngine.playButtonClick();
                sendLobbyCommand({ type: 'ready', ready: next });
              }}
            >
              {meSlot?.ready ? '✓ Вы готовы' : 'В бой! (Готов)'}
            </button>
            {isHost && (
              <button
                type="button"
                className="cw-btn-3d btn-red btn-lg btn-block"
                disabled={!canStart}
                onClick={() => {
                  soundEngine.playGong();
                  sendLobbyCommand({ type: 'start' });
                }}
              >
                ⚔️ Начать матч!
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
        </aside>
      </div>

      <dialog
        ref={previewDialogRef}
        className="cw-lobby-deck-dialog cw-felt-box"
        aria-labelledby="cw-lobby-deck-title"
        onCancel={(e) => {
          e.preventDefault();
          setPreviewSeat(null);
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setPreviewSeat(null);
        }}
      >
        {previewSeat !== null && lobby.slots[previewSeat]?.deck && (
          <>
            <div className="cw-settings-head">
              <div>
                <h2 id="cw-lobby-deck-title" className="cw-ink-title">
                  Колода: {lobby.slots[previewSeat]!.nickname}
                </h2>
                <span className="cw-lobby-deck-sub">
                  {heroName(lobby.slots[previewSeat]!.deck!.heroId)} ·{' '}
                  {lobby.slots[previewSeat]!.deck!.cards.length}/{CONFIG.deckSize} карт
                </span>
              </div>
              <button
                type="button"
                className="cw-btn-3d btn-dark btn-sm"
                aria-label="Закрыть просмотр колоды"
                onClick={() => setPreviewSeat(null)}
              >
                ✕
              </button>
            </div>
            <div className="cw-lobby-deck-dialog__body cw-paper-box" data-zoom-bounds>
              <DeckPreview deck={lobby.slots[previewSeat]!.deck!} />
            </div>
          </>
        )}
      </dialog>
    </main>
  );
}
