/**
 * DeckList
 * Экран «Мои колоды» — список сохранённых локально колод.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { copyToClipboard } from '../utils/clipboard'
import { useBackNavigation, useNavigateWithOrigin } from '../hooks/useBackNavigation'
import { saveDeckSelection, sumDeckQuantities } from '../utils/deckState'
import { useDecks } from '../hooks/useDecks'
import { useHeroes } from '../hooks/useHeroes'
import { HeroDisplay } from './HeroDisplay'
import { ConfirmDialog } from './Shared/ConfirmDialog'
import './DeckList.css'

export function DeckList() {
  const navigate = useNavigateWithOrigin()
  const goBack = useBackNavigation('/')
  const { decks, selectedDeckId, selectDeck, removeDeck, renameDeck } = useDecks()
  const { heroes } = useHeroes()
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
    saveDeckSelection(deck.selectedCards || {}, deck.selectedLands || {}, {
      heroId: deck.heroId ?? null,
      editingDeckId: deck.id,
    })
    navigate('/deck')
  }

  const heroById = useMemo(() => {
    const map = new Map()
    if (!Array.isArray(heroes)) return map
    for (const h of heroes) {
      if (h?.id) map.set(h.id, h)
    }
    return map
  }, [heroes])

  const resolveHero = (deck) => {
    if (!deck?.heroId) return null
    return heroById.get(deck.heroId) || null
  }

  return (
    <main className="decks-page">
      <header className="decks-header">
        <button className="back-btn" onClick={goBack}>← Назад</button>
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
          const hero = resolveHero(deck)

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
                <span className="deck-stat" title="Карты">🃏 {cardCount} / 40</span>
                <span className="deck-stat" title="Земли">🌍 {landCount} / 4</span>
                {hero ? (
                  <span className="deck-stat deck-stat--hero" title="Герой">
                    <HeroDisplay hero={hero} align="right" />
                  </span>
                ) : (
                  <span className="deck-stat deck-stat--hero deck-stat--empty" title="Герой не выбран">
                    🦸 Без героя
                  </span>
                )}
                <button
                  type="button"
                  className="copy-btn copy-btn--inline"
                  onClick={() => handleCopy(deck.code, deck.id)}
                  title="Скопировать код колоды"
                  aria-label={copiedId === deck.id ? 'Код скопирован' : 'Скопировать код колоды'}
                  disabled={!deck.code}
                >
                  {copiedId === deck.id ? '✓ Скопировано' : '📋 Скопировать'}
                </button>
              </div>

              <p className="deck-card-desc">
                {deck.description ||
                  (hero
                    ? `Колода героя «${hero.name}»`
                    : 'Герой не выбран — откройте редактор, чтобы назначить героя')}
              </p>

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
    </main>
  )
}

export default DeckList
