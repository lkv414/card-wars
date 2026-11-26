import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { CONFIG } from '@card-wars/protocol';
import { PLAYABLE_LAND_TYPES, heroes, type LandType } from '@card-wars/content';
import {
  decodeDeckCode,
  encodeDeckCode,
  generateRandomDeck,
  getSelectedDeckId,
  heroName,
  loadDecks,
  newDeck,
  saveDecks,
  setSelectedDeckId,
  validateSavedDeck,
  type SavedDeck,
} from '../decks';
import { DeckEditor, clearEditorDraft, loadEditorDraft } from './DeckEditor';
import { DeckPreview } from './DeckPreview';

function isPointerOutside(e: ReactPointerEvent<HTMLDialogElement>): boolean {
  const rect = e.currentTarget.getBoundingClientRect();
  return e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
}

export function DecksScreen({ onBack }: { onBack: () => void }) {
  const [decks, setDecks] = useState<SavedDeck[]>(() => loadDecks());
  const [selectedId, setSelectedId] = useState<string | null>(() => getSelectedDeckId() ?? loadDecks()[0]?.id ?? null);
  const [editing, setEditing] = useState<SavedDeck | null>(() => loadEditorDraft());
  const [importCode, setImportCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingDeck, setDeletingDeck] = useState<SavedDeck | null>(null);

  const toastTimerRef = useRef<number | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement | null>(null);
  const deletePressedOutsideRef = useRef(false);

  const clearToastTimer = useCallback(() => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
  }, []);

  const showSuccess = useCallback(
    (msg: string) => {
      clearToastTimer();
      setError(null);
      setMessage(msg);
      toastTimerRef.current = window.setTimeout(() => {
        setMessage(null);
        toastTimerRef.current = null;
      }, 3000);
    },
    [clearToastTimer],
  );

  const showError = useCallback(
    (msg: string) => {
      clearToastTimer();
      setMessage(null);
      setError(msg);
      toastTimerRef.current = window.setTimeout(() => {
        setError(null);
        toastTimerRef.current = null;
      }, 3000);
    },
    [clearToastTimer],
  );

  useEffect(() => {
    return () => clearToastTimer();
  }, [clearToastTimer]);

  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (!dialog) return;
    if (deletingDeck) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [deletingDeck]);

  const persist = (next: SavedDeck[]) => {
    setDecks(next);
    saveDecks(next);
  };

  const saveDeck = (deck: SavedDeck) => {
    const exists = decks.some((d) => d.id === deck.id);
    persist(exists ? decks.map((d) => (d.id === deck.id ? deck : d)) : [...decks, deck]);
    setSelectedId(deck.id);
    setSelectedDeckId(deck.id);
    clearEditorDraft();
    setEditing(null);
    showSuccess(`Колода «${deck.name}» сохранена`);
  };

  const createDeck = () => {
    clearToastTimer();
    setMessage(null);
    setError(null);
    setEditing(newDeck());
  };

  const createRandomDeck = () => {
    const randomHero = heroes[Math.floor(Math.random() * heroes.length)] ?? heroes[0]!;
    const l1 = PLAYABLE_LAND_TYPES[Math.floor(Math.random() * PLAYABLE_LAND_TYPES.length)] ?? 'blue';
    const l2 = PLAYABLE_LAND_TYPES[Math.floor(Math.random() * PLAYABLE_LAND_TYPES.length)] ?? 'corn';
    const randomLands: LandType[] = [l1, l1, l2, l2];
    const randomCards = generateRandomDeck(randomHero.id, randomLands, []);

    const deck: SavedDeck = {
      id: `deck-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      name: `Случайная (${randomHero.name})`,
      heroId: randomHero.id,
      lands: randomLands,
      landIds: [null, null, null, null],
      cards: randomCards,
    };
    persist([...decks, deck]);
    setSelectedId(deck.id);
    setSelectedDeckId(deck.id);
    showSuccess(`Создана случайная колода «${deck.name}» (40 карт)`);
  };

  const duplicate = (deck: SavedDeck) => {
    const copy: SavedDeck = {
      ...deck,
      id: `deck-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      name: `${deck.name} (копия)`,
      lands: [...deck.lands],
      ...(deck.landIds ? { landIds: [...deck.landIds] } : {}),
      cards: [...deck.cards],
    };
    persist([...decks, copy]);
    showSuccess(`Создана копия «${deck.name}»`);
  };

  const confirmDelete = () => {
    if (!deletingDeck) return;
    const next = decks.filter((d) => d.id !== deletingDeck.id);
    persist(next);
    if (selectedId === deletingDeck.id) {
      const nextId = next[0]?.id ?? null;
      setSelectedId(nextId);
      if (nextId) {
        setSelectedDeckId(nextId);
      } else {
        try {
          localStorage.removeItem('cw-selected-deck');
        } catch {}
      }
    }
    const deletedName = deletingDeck.name;
    setDeletingDeck(null);
    showSuccess(`Колода «${deletedName}» удалена`);
  };

  const makeActive = (deck: SavedDeck) => {
    if (deck.cards.length < CONFIG.deckSize) {
      showError(`Нельзя выбрать неполную колоду: ${deck.cards.length}/${CONFIG.deckSize} карт`);
      return;
    }
    setSelectedId(deck.id);
    setSelectedDeckId(deck.id);
    showSuccess(`Активная колода: «${deck.name}»`);
  };

  const copyCode = async (deck: SavedDeck) => {
    const errors = validateSavedDeck(deck);
    if (errors.length > 0) {
      showError(`Код недоступен: ${errors[0]}`);
      return;
    }
    const code = encodeDeckCode(deck);
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!copied) {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = code;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        copied = false;
      }
    }
    if (copied) {
      showSuccess(`Код колоды «${deck.name}» скопирован в буфер обмена`);
    } else {
      showError('Не удалось скопировать код в буфер обмена');
    }
  };

  const importDeck = () => {
    const result = decodeDeckCode(importCode);
    if (!result.ok) {
      showError(result.error);
      return;
    }
    persist([...decks, result.deck]);
    setSelectedId(result.deck.id);
    setSelectedDeckId(result.deck.id);
    setImportCode('');
    showSuccess(`Импортирована колода «${result.deck.name}»`);
  };

  if (editing) {
    return (
      <DeckEditor
        deck={editing}
        onSave={saveDeck}
        onClose={() => {
          clearEditorDraft();
          setEditing(null);
        }}
      />
    );
  }

  return (
    <main className="decks-page ui-v2">
      <header className="decks-header">
        <button type="button" className="cw-btn-3d btn-dark btn-sm" onClick={onBack}>
          ← В меню
        </button>
        <div className="decks-title">
          <span className="eyebrow menu-eyebrow">Card Wars</span>
          <h1 className="cw-ink-title">Мои колоды</h1>
        </div>
        <div className="decks-header-actions">
          <button
            type="button"
            className="cw-btn-3d btn-orange btn-sm"
            onClick={createRandomDeck}
            title="Создать готовую сбалансированную колоду со случайным героем и землями"
          >
            🎲 + Случайная колода
          </button>
          <button type="button" className="cw-btn-3d btn-green btn-sm" onClick={createDeck}>
            + Создать колоду
          </button>
        </div>
      </header>
      <p className="decks-subtitle">Выберите активную колоду или соберите новую</p>

      <section className="decks-import-bar cw-paper-box" aria-label="Импорт колоды по коду">
        <h2 className="cw-ink-title">Импорт по коду</h2>
        <div className="join-row">
          <input
            placeholder="Вставьте код колоды…"
            style={{ fontSize: '16px' }}
            value={importCode}
            onChange={(e) => setImportCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && importCode.trim()) importDeck();
            }}
          />
          <button
            type="button"
            className="cw-btn-3d btn-green btn-sm"
            disabled={!importCode.trim()}
            onClick={importDeck}
          >
            Импортировать
          </button>
        </div>
      </section>

      {message && (
        <div className="cw-toast cw-toast--success" role="status" aria-live="polite">
          {message}
        </div>
      )}
      {error && (
        <div className="cw-toast cw-toast--error" role="alert">
          {error}
        </div>
      )}

      {decks.length === 0 ? (
        <div className="decks-empty cw-felt-box">
          <p className="decks-empty-title cw-ink-title">У вас пока нет колод</p>
          <p className="decks-empty-hint">
            Создайте новую колоду с нуля или сгенерируйте сбалансированную колоду со случайным героем в один клик.
          </p>
          <div className="decks-empty-actions">
            <button type="button" className="cw-btn-3d btn-green" onClick={createDeck}>
              + Создать колоду
            </button>
            <button type="button" className="cw-btn-3d btn-orange" onClick={createRandomDeck}>
              🎲 + Случайная колода
            </button>
          </div>
        </div>
      ) : (
        <div className="decks-grid">
          {decks.map((deck) => {
            const problems = validateSavedDeck(deck);
            const active = selectedId === deck.id;
            const isComplete = deck.cards.length === CONFIG.deckSize;
            return (
              <article key={deck.id} className={`deck-card cw-paper-box ${active ? 'active' : ''}`}>
                {active && <span className="active-badge">активная</span>}
                {!isComplete && (
                  <span className="incomplete-badge">
                    Не готова ({deck.cards.length}/{CONFIG.deckSize})
                  </span>
                )}
                <div className="deck-card-top">
                  <h3 className="deck-name cw-ink-title">{deck.name}</h3>
                </div>
                <div className="deck-stats">
                  <span className="deck-stat deck-stat--hero">{heroName(deck.heroId)}</span>
                  <span className={`deck-stat ${isComplete ? 'deck-stat--ok' : 'deck-stat--warn'}`}>
                    {deck.cards.length} / {CONFIG.deckSize} карт
                  </span>
                  <span className="deck-stat">{deck.lands.length} земли</span>
                </div>
                <DeckPreview deck={deck} compact />
                <div className={`deck-card-desc ${problems.length > 0 ? 'deck-card-desc--error' : ''}`}>
                  {problems[0] ?? 'Колода готова к игре'}
                </div>
                <div className="deck-actions">
                  <button
                    type="button"
                    className={`cw-btn-3d ${active ? 'btn-gold' : 'btn-green'} btn-sm`}
                    onClick={() => makeActive(deck)}
                    disabled={active || !isComplete}
                    title={!isComplete ? `Колода не готова (${deck.cards.length}/${CONFIG.deckSize} карт)` : active ? 'Колода уже выбрана' : 'Выбрать колоду'}
                  >
                    {active ? '✓ Выбрана' : !isComplete ? `Не готова (${deck.cards.length}/${CONFIG.deckSize})` : 'Выбрать'}
                  </button>
                  <button type="button" className="cw-btn-3d btn-blue btn-sm" onClick={() => setEditing(deck)}>
                    Изменить
                  </button>
                  <button type="button" className="cw-btn-3d btn-purple btn-sm" onClick={() => void copyCode(deck)}>
                    Код
                  </button>
                  <button type="button" className="cw-btn-3d btn-blue btn-sm" onClick={() => duplicate(deck)}>
                    Копия
                  </button>
                  <button type="button" className="cw-btn-3d btn-red btn-sm" onClick={() => setDeletingDeck(deck)}>
                    Удалить
                  </button>
                </div>
              </article>
            );
          })}

          <button type="button" className="big-create-btn cw-felt-box cw-btn-3d btn-dark" onClick={createDeck}>
            + Создать новую колоду
          </button>
        </div>
      )}

      <dialog
        ref={deleteDialogRef}
        className="cw-dialog cw-felt-box"
        aria-labelledby="delete-deck-dialog-title"
        {...({ closedby: 'any' } as Record<string, string>)}
        onPointerDown={(e) => {
          if (!('closedBy' in HTMLDialogElement.prototype)) {
            deletePressedOutsideRef.current = isPointerOutside(e);
          }
        }}
        onPointerUp={(e) => {
          if (!('closedBy' in HTMLDialogElement.prototype) && deletePressedOutsideRef.current && isPointerOutside(e)) {
            e.currentTarget.close();
          }
          deletePressedOutsideRef.current = false;
        }}
        onClose={() => setDeletingDeck(null)}
      >
        {deletingDeck && (
          <>
            <div className="cw-dialog__head">
              <h2 id="delete-deck-dialog-title" className="cw-ink-title">
                Удалить колоду?
              </h2>
              <button
                type="button"
                className="cw-dialog__close cw-btn-3d btn-dark btn-sm"
                onClick={() => setDeletingDeck(null)}
                aria-label="Закрыть"
              >
                ✕
              </button>
            </div>
            <div className="cw-dialog__body">
              <p>
                Вы уверены, что хотите удалить колоду «<strong>{deletingDeck.name}</strong>»? Это действие нельзя отменить.
              </p>
            </div>
            <div className="cw-dialog__actions">
              <button
                type="button"
                autoFocus
                className="cw-btn-3d btn-dark btn-sm"
                onClick={() => setDeletingDeck(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="cw-btn-3d btn-red btn-sm"
                onClick={confirmDelete}
              >
                Удалить
              </button>
            </div>
          </>
        )}
      </dialog>
    </main>
  );
}
