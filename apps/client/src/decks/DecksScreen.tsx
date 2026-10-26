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
    return (
      <div className="screen">
        <DeckEditor deck={editing} onSave={saveDeck} onClose={() => setEditing(null)} />
      </div>
    );
  }

  return (
    <div className="screen decks-screen">
      <header className="screen-head">
        <button className="mini" onClick={onBack}>
          ← В меню
        </button>
        <h1>Колоды</h1>
        <button onClick={createDeck}>Создать колоду</button>
      </header>

      {message && <div className="ok-line">{message}</div>}
      {error && <div className="error-line">{error}</div>}

      <div className="decks-grid">
        {decks.map((deck) => {
          const problems = validateSavedDeck(deck);
          return (
            <div key={deck.id} className={`deck-card panel ${selectedId === deck.id ? 'selected' : ''}`}>
              <div className="deck-card-head">
                <b>{deck.name}</b>
                {selectedId === deck.id && <span className="badge">активная</span>}
              </div>
              <div className="hint">
                {heroName(deck.heroId)} · {deck.cards.length} / {CONFIG.deckSize} карт
              </div>
              <div className="hint">земли: {deck.lands.join(', ')}</div>
              {problems.length > 0 && <div className="error-line">{problems[0]}</div>}
              <div className="deck-card-actions">
                <button className="mini" onClick={() => setEditing(deck)}>
                  Изменить
                </button>
                <button className="mini" onClick={() => makeActive(deck)} disabled={selectedId === deck.id}>
                  Выбрать
                </button>
                <button className="mini" onClick={() => showCode(deck)}>
                  Код
                </button>
                <button className="mini" onClick={() => duplicate(deck)}>
                  Копия
                </button>
                <button className="mini danger" onClick={() => remove(deck)}>
                  Удалить
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {codePanel && (
        <div className="panel code-panel">
          <b>Код колоды «{codePanel.deck.name}»</b>
          <p className="hint">Скопируйте и вставьте на другом устройстве в поле импорта.</p>
          <textarea readOnly value={codePanel.code} rows={3} />
          <div className="row">
            <button
              className="mini"
              onClick={() => {
                navigator.clipboard?.writeText(codePanel.code);
                setMessage('Код скопирован');
              }}
            >
              Скопировать
            </button>
            <button className="mini" onClick={() => setCodePanel(null)}>
              Закрыть
            </button>
          </div>
        </div>
      )}

      <div className="panel import-panel">
        <b>Импорт по коду</b>
        <div className="row">
          <input
            placeholder="Вставьте код колоды"
            value={importCode}
            onChange={(e) => setImportCode(e.target.value)}
          />
          <button disabled={!importCode.trim()} onClick={importDeck}>
            Импортировать
          </button>
        </div>
      </div>
    </div>
  );
}
