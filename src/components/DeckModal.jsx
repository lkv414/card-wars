import { useEffect, useMemo, useRef, useState } from 'react'
import { DECK_LIMITS } from '../constants/game'
import { CardGrid } from './CardGrid'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { groupCardsByCost, groupCardsByType } from '../utils/cardSort'

const { cards: CARD_LIMITS, lands: LAND_LIMITS } = DECK_LIMITS

const normalizeId = (value) => String(value).trim().toLowerCase()

const findById = (list, id) => {
  const normalized = normalizeId(id)
  return list.find((item) => normalizeId(item.id) === normalized)
}

export function DeckModal({
  open,
  onClose,
  selectedCards,
  selectedLands,
  cards,
  lands,
  addCard,
  removeCard,
  addLand,
  removeLand,
  onPreview,
  onBlockedAdd,
}) {
  const dialogRef = useRef(null)
  const [groupMode, setGroupMode] = useState('type')
  useFocusTrap(open, dialogRef)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      // Nested overlays (preview) stop this in capture; only close deck if still open.
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const cardTotal = Object.values(selectedCards).reduce((a, b) => a + b, 0)
  const landTotal = Object.values(selectedLands).reduce((a, b) => a + b, 0)
  const cardsOk = cardTotal === CARD_LIMITS.maxTotal
  const landsOk = landTotal === LAND_LIMITS.maxTotal

  const deckCards = useMemo(
    () =>
      Object.keys(selectedCards).map((id) => ({
        id,
        found: findById(cards, id),
      })),
    [selectedCards, cards]
  )

  const deckLands = useMemo(
    () =>
      Object.keys(selectedLands).map((id) => ({
        id,
        found: findById(lands, id),
      })),
    [selectedLands, lands]
  )

  const foundDeckCards = useMemo(
    () => deckCards.filter((entry) => entry.found).map((entry) => entry.found),
    [deckCards]
  )
  const missingDeckCards = useMemo(() => deckCards.filter((entry) => !entry.found), [deckCards])
  const foundDeckLands = useMemo(
    () => deckLands.filter((entry) => entry.found).map((entry) => entry.found),
    [deckLands]
  )
  const missingDeckLands = useMemo(() => deckLands.filter((entry) => !entry.found), [deckLands])

  const cardGroups = useMemo(
    () => (groupMode === 'cost' ? groupCardsByCost(foundDeckCards) : groupCardsByType(foundDeckCards)),
    [groupMode, foundDeckCards]
  )

  if (!open) return null

  return (
    <div className="deck-modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="deck-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="deck-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="deck-modal-header">
          <div className="deck-modal-header-main">
            <h2 id="deck-modal-title">Твоя колода</h2>
            <div className="deck-modal-tally">
              <span className={cardsOk ? 'tally-ok' : 'tally-bad'}>
                {cardTotal} / {CARD_LIMITS.maxTotal} карт
              </span>
              <span className="tally-sep" aria-hidden="true">
                ·
              </span>
              <span className={landsOk ? 'tally-ok' : 'tally-bad'}>
                {landTotal} / {LAND_LIMITS.maxTotal} земли
              </span>
            </div>
            <div className="deck-progress deck-progress-modal" aria-hidden="true">
              <div className="deck-progress-track">
                <div
                  className={`deck-progress-fill cards ${cardsOk ? 'ok' : ''}`}
                  style={{ width: `${Math.min(100, (cardTotal / CARD_LIMITS.maxTotal) * 100)}%` }}
                />
              </div>
              <div className="deck-progress-track land">
                <div
                  className={`deck-progress-fill lands ${landsOk ? 'ok' : ''}`}
                  style={{ width: `${Math.min(100, (landTotal / LAND_LIMITS.maxTotal) * 100)}%` }}
                />
              </div>
            </div>
          </div>
          <button type="button" className="deck-modal-close" onClick={onClose}>
            Готово
          </button>
        </div>

        <div className="deck-modal-toolbar">
          <span className="deck-modal-toolbar-label">Группировка карт</span>
          <div className="mode-tabs deck-group-tabs">
            <button
              type="button"
              className={groupMode === 'type' ? 'active' : ''}
              onClick={() => setGroupMode('type')}
            >
              По типу
            </button>
            <button
              type="button"
              className={groupMode === 'cost' ? 'active' : ''}
              onClick={() => setGroupMode('cost')}
            >
              По стоимости
            </button>
          </div>
        </div>

        <div className="deck-modal-content">
          <section className="deck-modal-section">
            <h3>
              Карты ({cardTotal} / {CARD_LIMITS.maxTotal})
            </h3>
            {foundDeckCards.length === 0 ? (
              <div className="empty-state empty-state-inline">
                <p className="empty-message">Пока пусто</p>
                <p className="empty-hint">Добавьте карты из библиотеки — клик по карте = +1</p>
                <button type="button" className="empty-cta" onClick={onClose}>
                  К библиотеке
                </button>
              </div>
            ) : (
              cardGroups.map((group) => (
                <div key={group.key} className="deck-group">
                  <h4 className="deck-group-title">
                    {group.label}{' '}
                    <span className="deck-group-count">
                      (
                      {group.items.reduce(
                        (sum, card) =>
                          sum +
                          (selectedCards[card.id] ||
                            selectedCards[String(card.id).trim().toLowerCase()] ||
                            0),
                        0
                      )}
                      )
                    </span>
                  </h4>
                  <CardGrid
                    cards={group.items}
                    selectedCards={selectedCards}
                    addCard={addCard}
                    removeCard={removeCard}
                    cardTotal={cardTotal}
                    onPreview={onPreview}
                    onBlockedAdd={onBlockedAdd}
                    compact
                  />
                </div>
              ))
            )}
            {missingDeckCards.length > 0 && (
              <div className="missing-list">
                <strong>Не найдены карты в библиотеке:</strong>
                <ul>
                  {missingDeckCards.map((entry) => (
                    <li key={entry.id}>{entry.id}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="deck-modal-section">
            <h3>
              Земли ({landTotal} / {LAND_LIMITS.maxTotal})
            </h3>
            {foundDeckLands.length === 0 ? (
              <div className="empty-state empty-state-inline">
                <p className="empty-message">Пока пусто</p>
                <p className="empty-hint">Переключитесь на вкладку «Земли» в фильтрах</p>
                <button type="button" className="empty-cta" onClick={onClose}>
                  К библиотеке
                </button>
              </div>
            ) : (
              <CardGrid
                cards={foundDeckLands}
                selectedCards={selectedLands}
                addCard={addLand}
                removeCard={removeLand}
                cardTotal={landTotal}
                isLands
                onPreview={onPreview}
                onBlockedAdd={onBlockedAdd}
                compact
              />
            )}
            {missingDeckLands.length > 0 && (
              <div className="missing-list">
                <strong>Не найдены земли в библиотеке:</strong>
                <ul>
                  {missingDeckLands.map((entry) => (
                    <li key={entry.id}>{entry.id}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
