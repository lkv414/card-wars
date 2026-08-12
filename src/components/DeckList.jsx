/**
 * DeckList
 * Экран «Мои колоды» — список сохранённых локально колод.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { copyToClipboard } from '../utils/clipboard'
import { saveDeckSelection, sumDeckQuantities } from '../utils/deckState'
import { useDecks } from '../hooks/useDecks'
import { usePresetDecks, presetToDeckSelection } from '../hooks/usePresetDecks'
import { ConfirmDialog } from './Shared/ConfirmDialog'
import './DeckList.css'

export function DeckList() {
  const navigate = useNavigate()
  const { decks, selectedDeckId, selectDeck, removeDeck, renameDeck, addDeck } = useDecks()
  const { presets, loading: presetsLoading, error: presetsError } = usePresetDecks()
  const [copiedId, setCopiedId] = useState(null)
  const [renamingId, setRenamingId] = useState(null)
  const [draftName, setDraftName] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const copyTimeoutRef = useRef(null)

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current)
      }
    }
  }, [])

  const handleCopy = async (code, id) => {
    const ok = await copyToClipboard(code, { fallbackPromptLabel: 'Скопируй код:' })
    if (!ok) return
    setCopiedId(id)
    if (copyTimeoutRef.current !== null) {
      window.clearTimeout(copyTimeoutRef.current)
    }
    copyTimeoutRef.current = window.setTimeout(() => {
      setCopiedId(null)
      copyTimeoutRef.current = null
    }, 1500)
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
    selectDeck(deck.id)
    saveDeckSelection(deck.selectedCards || {}, deck.selectedLands || {})
    navigate('/deck')
  }

  const handleImportPreset = (preset) => {
    const { selectedCards, selectedLands, name } = presetToDeckSelection(preset)
    const deck = addDeck({ name, selectedCards, selectedLands })
    saveDeckSelection(deck.selectedCards, deck.selectedLands)
    navigate('/deck')
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
          const cardCount = sumDeckQuantities(deck.selectedCards)
          const landCount = sumDeckQuantities(deck.selectedLands)
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
                  type="button"
                  className="rename-btn"
                  onClick={() => handleStartRename(deck)}
                  title="Переименовать"
                  aria-label="Переименовать колоду"
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
                  aria-label={copiedId === deck.id ? 'Код скопирован' : 'Скопировать код колоды'}
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
                <ConfirmDialog
                  open
                  title="Удалить колоду?"
                  message={`Удалить колоду «${deck.name}»?`}
                  confirmLabel="Удалить"
                  cancelLabel="Отмена"
                  danger
                  onConfirm={() => {
                    removeDeck(deck.id)
                    setConfirmDeleteId(null)
                  }}
                  onCancel={() => setConfirmDeleteId(null)}
                />
              )}
            </div>
          )
        })}
      </div>

      <section className="decks-presets" aria-label="Готовые колоды">
        <h2>Готовые колоды</h2>
        {presetsLoading && <p role="status">Загрузка пресетов…</p>}
        {presetsError && <p className="decks-presets-error" role="alert">{presetsError}</p>}
        {!presetsLoading && presets.length === 0 && (
          <p className="decks-presets-empty">Пресеты пока не загружены в базу.</p>
        )}
        <div className="decks-presets-grid">
          {presets.map((preset) => {
            const { selectedCards, selectedLands } = presetToDeckSelection(preset)
            const cardCount = sumDeckQuantities(selectedCards)
            const landCount = sumDeckQuantities(selectedLands)
            return (
              <article key={preset.id} className="deck-card deck-card--preset">
                <h3>{preset.name}</h3>
                {preset.description && <p className="deck-preset-desc">{preset.description}</p>}
                <div className="deck-stats">
                  <span>🃏 {cardCount}</span>
                  <span>🌍 {landCount}</span>
                </div>
                <button type="button" className="select-btn" onClick={() => handleImportPreset(preset)}>
                  Импортировать
                </button>
              </article>
            )
          })}
        </div>
      </section>
    </main>
  )
}

export default DeckList
