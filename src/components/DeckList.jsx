/**
 * DeckList
 * Экран «Мои колоды» — список сохранённых локально колод.
 *
 * Маршрут: /decks (между меню и редактором колод)
 *
 * Каждая колода:
 *   - Название (редактируется inline)
 *   - Код (DK-XXXXXX) с кнопкой «Скопировать»
 *   - Превью: «12 карт / 3 земли»
 *   - Кнопка «Выбрать» (отмечает как активную)
 *   - Кнопка «Редактировать» (загружает в редактор)
 *   - Кнопка «Удалить» (с подтверждением)
 */
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useDecks } from '../hooks/useDecks'
import './DeckList.css'

export function DeckList() {
  const navigate = useNavigate()
  const { decks, selectedDeckId, selectDeck, removeDeck, addDeck, renameDeck } = useDecks()
  const [copiedId, setCopiedId] = useState(null)
  const [renamingId, setRenamingId] = useState(null)
  const [draftName, setDraftName] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  const handleCopy = async (code, id) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1500)
    } catch {
      window.prompt('Скопируй код:', code)
    }
  }

  const handleStartRename = (deck) => {
    setRenamingId(deck.id)
    setDraftName(deck.name)
  }

  const handleSaveRename = (id) => {
    renameDeck(id, draftName)
    setRenamingId(null)
    setDraftName('')
  }

  const handleEdit = (deck) => {
    // Загрузить выбор этой колоды в deckSelection (использует useDeckSelection).
    try {
      localStorage.setItem(
        'deckSelection',
        JSON.stringify({
          selectedCards: deck.selectedCards || {},
          selectedLands: deck.selectedLands || {},
        })
      )
    } catch {
      /* ignore */
    }
    navigate('/deck')
  }

  const handleCreateEmpty = () => {
    const newDeck = addDeck({
      name: 'Новая колода',
      selectedCards: {},
      selectedLands: {},
    })
    handleEdit(newDeck)
  }

  return (
    <main className="decks-page">
      <header className="decks-header">
        <button className="back-btn" onClick={() => navigate('/')}>← Назад</button>
        <h1>Мои колоды</h1>
        <button className="create-btn" onClick={() => navigate('/deck')}>
          + Создать колоду
        </button>
      </header>

      <div className="decks-subtitle">
        {decks.length === 0 ? (
          <p>У тебя пока нет сохранённых колод. Создай первую.</p>
        ) : (
          <p>
            {decks.length} {decks.length === 1 ? 'колода' : decks.length < 5 ? 'колоды' : 'колод'}
            {selectedDeckId && ' · активная отмечена галочкой'}
          </p>
        )}
      </div>

      <div className="decks-grid">
        {decks.length === 0 && (
          <div className="decks-empty">
            <button className="big-create-btn" onClick={() => navigate('/deck')}>
              + Создать первую колоду
            </button>
          </div>
        )}

        {decks.map((deck) => {
          const cardCount = Object.values(deck.selectedCards || {}).reduce((s, q) => s + Number(q || 0), 0)
          const landCount = Object.values(deck.selectedLands || {}).reduce((s, q) => s + Number(q || 0), 0)
          const isActive = deck.id === selectedDeckId

          return (
            <div
              key={deck.id}
              className={`deck-card ${isActive ? 'active' : ''}`}
            >
              {isActive && <span className="active-badge">✓ Активна</span>}

              <div className="deck-card-top">
                {renamingId === deck.id ? (
                  <input
                    className="deck-name-input"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveRename(deck.id)
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    onBlur={() => handleSaveRename(deck.id)}
                    autoFocus
                  />
                ) : (
                  <h3 className="deck-name" onDoubleClick={() => handleStartRename(deck)}>
                    {deck.name}
                  </h3>
                )}
                <button
                  className="rename-btn"
                  onClick={() => handleStartRename(deck)}
                  title="Переименовать"
                >
                  ✏️
                </button>
              </div>

              <div className="deck-stats">
                <span>🃏 {cardCount} / 40</span>
                <span>🌍 {landCount} / 4</span>
              </div>

              <div className="deck-code-row">
                <code className="deck-code" title={deck.code || 'Код колоды'}>
                  {deck.code || '—'}
                </code>
                <button
                  type="button"
                  className="copy-btn"
                  onClick={() => handleCopy(deck.code, deck.id)}
                  title="Скопировать полный код"
                  disabled={!deck.code}
                >
                  {copiedId === deck.id ? '✓' : '📋'}
                </button>
              </div>

              <div className="deck-actions">
                {!isActive && (
                  <button
                    className="select-btn"
                    onClick={() => selectDeck(deck.id)}
                  >
                    Выбрать
                  </button>
                )}
                <button className="edit-btn" onClick={() => handleEdit(deck)}>
                  Редактировать
                </button>
                <button
                  className="delete-btn"
                  onClick={() => setConfirmDeleteId(deck.id)}
                >
                  Удалить
                </button>
              </div>

              {confirmDeleteId === deck.id && (
                <div className="confirm-overlay" onClick={() => setConfirmDeleteId(null)}>
                  <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
                    <p>Удалить колоду «{deck.name}»?</p>
                    <div className="confirm-actions">
                      <button
                        className="confirm-cancel"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Отмена
                      </button>
                      <button
                        className="confirm-delete"
                        onClick={() => {
                          removeDeck(deck.id)
                          setConfirmDeleteId(null)
                        }}
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </main>
  )
}

export default DeckList
