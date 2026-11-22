import { useEffect, useState } from 'react';
import { CONFIG } from '@card-wars/protocol';
import { LAND_TYPES, heroes, type LandType } from '@card-wars/content';
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

export function DecksScreen({ onBack }: { onBack: () => void }) {
  const [decks, setDecks] = useState<SavedDeck[]>(() => loadDecks());
  const [selectedId, setSelectedId] = useState<string | null>(() => getSelectedDeckId() ?? loadDecks()[0]?.id ?? null);
  const [editing, setEditing] = useState<SavedDeck | null>(() => loadEditorDraft());
  const [codePanel, setCodePanel] = useState<{ deck: SavedDeck; code: string } | null>(null);
  const [importCode, setImportCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingDeck, setDeletingDeck] = useState<SavedDeck | null>(null);

  useEffect(() => {
    if (!deletingDeck) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDeletingDeck(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
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
    setMessage(`Колода «${deck.name}» сохранена`);
    setError(null);
  };

  const createDeck = () => {
    setEditing(newDeck());
    setMessage(null);
    setError(null);
  };

  const createRandomDeck = () => {
    const randomHero = heroes[Math.floor(Math.random() * heroes.length)] ?? heroes[0]!;
    const playableLands = LAND_TYPES.filter((l) => l !== 'rainbow');
    const l1 = playableLands[Math.floor(Math.random() * playableLands.length)] ?? 'blue';
    const l2 = playableLands[Math.floor(Math.random() * playableLands.length)] ?? 'corn';
    const randomLands: LandType[] = [l1, l1, l2, l2];
    const randomCards = generateRandomDeck(randomHero.id, randomLands, []);

    const deck: SavedDeck = {
      id: `deck-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      name: `Случайная (${randomHero.name})`,
      heroId: randomHero.id,
      lands: randomLands,
      cards: randomCards,
    };
    persist([...decks, deck]);
    setSelectedId(deck.id);
    setSelectedDeckId(deck.id);
    setMessage(`Создана случайная колода «${deck.name}» (40 карт)`);
    setError(null);
  };

  const duplicate = (deck: SavedDeck) => {
    const copy: SavedDeck = {
      ...deck,
      id: `deck-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      name: `${deck.name} (копия)`,
      lands: [...deck.lands],
      cards: [...deck.cards],
    };
    persist([...decks, copy]);
    setMessage(`Создана копия «${deck.name}»`);
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
    if (codePanel?.deck.id === deletingDeck.id) setCodePanel(null);
    setMessage(`Колода «${deletingDeck.name}» удалена`);
    setDeletingDeck(null);
  };

  const makeActive = (deck: SavedDeck) => {
    if (deck.cards.length < CONFIG.deckSize) {
      setError(`Нельзя выбрать неполную колоду: ${deck.cards.length}/${CONFIG.deckSize} карт`);
      return;
    }
    setSelectedId(deck.id);
    setSelectedDeckId(deck.id);
    setMessage(`Активная колода: «${deck.name}»`);
  };

  const showCode = (deck: SavedDeck) => {
    const errors = validateSavedDeck(deck);
    if (errors.length > 0) {
      setError(`Код недоступен: ${errors[0]}`);
      return;
    }
    setCodePanel({ deck, code: encodeDeckCode(deck) });
    setError(null);
  };

  const importDeck = () => {
    const result = decodeDeckCode(importCode);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    persist([...decks, result.deck]);
    setSelectedId(result.deck.id);
    setSelectedDeckId(result.deck.id);
    setImportCode('');
    setMessage(`Импортирована колода «${result.deck.name}»`);
    setError(null);
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
        <button className="back-btn" onClick={onBack}>
          ← В меню
        </button>
        <div className="decks-title">
          <span className="eyebrow">Card Wars</span>
          <h1>Мои колоды</h1>
        </div>
        <div className="decks-header-actions">
          <button
            className="cw-random-btn"
            onClick={createRandomDeck}
            title="Создать готовую сбалансированную колоду со случайным героем и землями"
          >
            🎲 + Случайная колода
          </button>
          <button className="create-btn" onClick={createDeck}>
            + Создать колоду
          </button>
        </div>
      </header>
      <p className="decks-subtitle">Выберите активную колоду или соберите новую</p>

      {message && <div className="ui-toast ui-toast--success">{message}</div>}
      {error && <div className="ui-toast ui-toast--error">{error}</div>}

      {decks.length === 0 ? (
        <div className="decks-empty">
          <p className="decks-empty-title">У вас пока нет колод</p>
          <p className="decks-empty-hint">
            Создайте новую колоду с нуля или сгенерируйте сбалансированную колоду со случайным героем в один клик.
          </p>
          <div className="decks-empty-actions">
            <button className="create-btn" onClick={createDeck}>
              + Создать колоду
            </button>
            <button className="cw-random-btn" onClick={createRandomDeck}>
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
              <article key={deck.id} className={`deck-card ${active ? 'active' : ''}`}>
                {active && <span className="active-badge">активная</span>}
                {!isComplete && (
                  <span className="incomplete-badge">
                    Не готова ({deck.cards.length}/{CONFIG.deckSize})
                  </span>
                )}
                <div className="deck-card-top">
                  <h3 className="deck-name">{deck.name}</h3>
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
                    className="select-btn"
                    onClick={() => makeActive(deck)}
                    disabled={active || !isComplete}
                    title={!isComplete ? `Колода не готова (${deck.cards.length}/${CONFIG.deckSize} карт)` : active ? 'Колода уже выбрана' : 'Выбрать колоду'}
                  >
                    {active ? 'Выбрана' : !isComplete ? `Не готова (${deck.cards.length}/${CONFIG.deckSize})` : 'Выбрать'}
                  </button>
                  <button className="edit-btn" onClick={() => setEditing(deck)}>
                    Изменить
                  </button>
                  <button className="code-btn" onClick={() => showCode(deck)}>
                    Код
                  </button>
                  <button className="edit-btn" onClick={() => duplicate(deck)}>
                    Копия
                  </button>
                  <button className="delete-btn" onClick={() => setDeletingDeck(deck)}>
                    Удалить
                  </button>
                </div>
              </article>
            );
          })}

          <button className="big-create-btn" onClick={createDeck}>
            + Создать новую колоду
          </button>
        </div>
      )}

      {deletingDeck && (
        <div
          className="cw-modal-backdrop"
          onClick={() => setDeletingDeck(null)}
          role="presentation"
        >
          <div
            className="cw-modal-box"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-deck-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-deck-dialog-title" className="cw-modal-title">
              Удалить колоду?
            </h2>
            <p className="cw-modal-body">
              Вы уверены, что хотите удалить колоду «<strong>{deletingDeck.name}</strong>»? Это действие нельзя отменить.
            </p>
            <div className="cw-modal-actions">
              <button
                className="cw-btn-secondary"
                onClick={() => setDeletingDeck(null)}
              >
                Отмена
              </button>
              <button
                className="cw-btn-danger"
                onClick={confirmDelete}
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {codePanel && (
        <section className="code-panel ui-card">
          <h2>Код колоды «{codePanel.deck.name}»</h2>
          <p className="hint">Скопируйте и вставьте на другом устройстве в поле импорта.</p>
          <textarea readOnly value={codePanel.code} rows={3} />
          <div className="row">
            <button
              className="btn-primary"
              onClick={() => {
                navigator.clipboard?.writeText(codePanel.code);
                setMessage('Код скопирован');
              }}
            >
              Скопировать
            </button>
            <button className="btn-soft" onClick={() => setCodePanel(null)}>
              Закрыть
            </button>
          </div>
        </section>
      )}

      <section className="decks-import ui-card">
        <h2>Импорт по коду</h2>
        <div className="join-row">
          <input
            placeholder="Вставьте код колоды"
            value={importCode}
            onChange={(e) => setImportCode(e.target.value)}
          />
          <button className="btn-primary" disabled={!importCode.trim()} onClick={importDeck}>
            Импортировать
          </button>
        </div>
      </section>
    </main>
  );
}
