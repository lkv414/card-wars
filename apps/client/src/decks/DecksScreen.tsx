import { useState } from 'react';
import { CONFIG } from '@card-wars/protocol';
import {
  decodeDeckCode,
  encodeDeckCode,
  getSelectedDeckId,
  heroName,
  loadDecks,
  newDeck,
  saveDecks,
  setSelectedDeckId,
  validateSavedDeck,
  type SavedDeck,
} from '../decks';
import { DeckEditor } from './DeckEditor';

export function DecksScreen({ onBack }: { onBack: () => void }) {
  const [decks, setDecks] = useState<SavedDeck[]>(() => loadDecks());
  const [selectedId, setSelectedId] = useState<string | null>(() => getSelectedDeckId() ?? loadDecks()[0]?.id ?? null);
  const [editing, setEditing] = useState<SavedDeck | null>(null);
  const [codePanel, setCodePanel] = useState<{ deck: SavedDeck; code: string } | null>(null);
  const [importCode, setImportCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const persist = (next: SavedDeck[]) => {
    setDecks(next);
    saveDecks(next);
  };

  const saveDeck = (deck: SavedDeck) => {
    const exists = decks.some((d) => d.id === deck.id);
    persist(exists ? decks.map((d) => (d.id === deck.id ? deck : d)) : [...decks, deck]);
    setSelectedId(deck.id);
    setSelectedDeckId(deck.id);
    setEditing(null);
    setMessage(`Колода «${deck.name}» сохранена`);
    setError(null);
  };

  const createDeck = () => {
    setEditing(newDeck());
    setMessage(null);
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

  const remove = (deck: SavedDeck) => {
    if (!confirm(`Удалить колоду «${deck.name}»?`)) return;
    if (decks.length <= 1) {
      setError('Нужна хотя бы одна колода');
      return;
    }
    const next = decks.filter((d) => d.id !== deck.id);
    persist(next);
    if (selectedId === deck.id) {
      setSelectedId(next[0]!.id);
      setSelectedDeckId(next[0]!.id);
    }
    if (codePanel?.deck.id === deck.id) setCodePanel(null);
    setMessage(`Колода «${deck.name}» удалена`);
  };

  const makeActive = (deck: SavedDeck) => {
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
    return <DeckEditor deck={editing} onSave={saveDeck} onClose={() => setEditing(null)} />;
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
        <button className="create-btn" onClick={createDeck}>
          + Создать колоду
        </button>
      </header>
      <p className="decks-subtitle">Выберите активную колоду или соберите новую</p>

      {message && <div className="ui-toast ui-toast--success">{message}</div>}
      {error && <div className="ui-toast ui-toast--error">{error}</div>}

      <div className="decks-grid">
        {decks.map((deck) => {
          const problems = validateSavedDeck(deck);
          const active = selectedId === deck.id;
          return (
            <article key={deck.id} className={`deck-card ${active ? 'active' : ''}`}>
              {active && <span className="active-badge">активная</span>}
              <div className="deck-card-top">
                <h3 className="deck-name">{deck.name}</h3>
              </div>
              <div className="deck-stats">
                <span className="deck-stat deck-stat--hero">{heroName(deck.heroId)}</span>
                <span className={`deck-stat ${deck.cards.length === CONFIG.deckSize ? 'deck-stat--ok' : 'deck-stat--warn'}`}>
                  {deck.cards.length} / {CONFIG.deckSize} карт
                </span>
                <span className="deck-stat">{deck.lands.length} земли</span>
              </div>
              <div className={`deck-card-desc ${problems.length > 0 ? 'deck-card-desc--error' : ''}`}>
                {problems[0] ?? 'Колода готова к игре'}
              </div>
              <div className="deck-actions">
                <button className="select-btn" onClick={() => makeActive(deck)} disabled={active}>
                  {active ? 'Выбрана' : 'Выбрать'}
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
                <button className="delete-btn" onClick={() => remove(deck)}>
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
