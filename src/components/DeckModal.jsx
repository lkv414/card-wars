import { useEffect, useMemo, useRef, useState } from 'react'
import { DECK_LIMITS } from '../constants/game'
import { CardGrid } from './CardGrid'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { groupCardsByCost, groupCardsByType } from '../utils/cardSort'
import { findByDeckEntryId, sumDeckQuantities } from '../utils/deckState'

const { cards: CARD_LIMITS, lands: LAND_LIMITS } = DECK_LIMITS

export function DeckModal({
  open,
  onClose,
  selectedCards,
  selectedLands,
  cards,
  lands,
  hero = null,
  onOpenHeroes,
  addCard,
  removeCard,
  addLand,
  removeLand,
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

  const cardTotal = sumDeckQuantities(selectedCards)
  const landTotal = sumDeckQuantities(selectedLands)
  const cardsOk = cardTotal === CARD_LIMITS.maxTotal
  const landsOk = landTotal === LAND_LIMITS.maxTotal

  const deckCards = useMemo(
    () =>
      Object.keys(selectedCards).map((id) => ({
        id,
        found: findByDeckEntryId(cards, id),
      })),
    [selectedCards, cards]
  )

  const deckLands = useMemo(
    () =>
      Object.keys(selectedLands).map((id) => ({
        id,
        found: findByDeckEntryId(lands, id),
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

  const cardGroups = useMemo(() => {
    if (groupMode === 'cost') return groupCardsByCost(foundDeckCards)
    if (groupMode === 'plain') return null
    return groupCardsByType(foundDeckCards)
  }, [groupMode, foundDeckCards])

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
              <span className="tally-sep" aria-hidden="true">
                ·
              </span>
              <button
                type="button"
                className={`deck-modal-tally-hero ${hero ? '' : 'deck-modal-tally-hero--missing'}`}
                onClick={() => onOpenHeroes?.()}
                title={hero ? `Герой: ${hero.name}` : 'Выберите Героя'}
                aria-label={
                  hero
                    ? `Герой колоды: ${hero.name}. Открыть выбор героя`
                    : 'Герой не выбран. Открыть выбор героя'
                }
              >
                Герой: {hero ? hero.name : 'Выберите Героя'}
              </button>
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
            <button
              type="button"
              className={groupMode === 'plain' ? 'active' : ''}
              onClick={() => setGroupMode('plain')}
            >
              Постой
            </button>
          </div>
        </div>

        <div className="deck-modal-content">
          <section className="deck-modal-section deck-modal-section--hero" aria-label="Панель Героя">
            {hero ? (
              <div className="deck-hero-panel">
                <div className="deck-hero-panel__art">
                  {hero.image_url ? (
                    <img src={hero.image_url} alt={hero.name} draggable={false} />
                  ) : (
                    <span className="deck-hero-panel__placeholder" aria-hidden="true">
                      Нет изображения
                    </span>
                  )}
                </div>
                <div className="deck-hero-panel__info">
                  <h4 className="deck-hero-panel__name">{hero.name}</h4>
                  <p className="deck-hero-panel__desc">{hero.description || 'Описание не указано.'}</p>
                </div>
              </div>
            ) : (
              <div className="deck-hero-panel deck-hero-panel--empty">
                <span className="deck-hero-panel__missing">Герой не выбран</span>
                <button type="button" className="empty-cta" onClick={() => onOpenHeroes?.()}>
                  Выбрать героя
                </button>
              </div>
            )}
          </section>

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
            ) : groupMode === 'plain' ? (
              <CardGrid
                cards={foundDeckCards}
                selectedCards={selectedCards}
                addCard={addCard}
                removeCard={removeCard}
                selectionTotal={cardTotal}
                onBlockedAdd={onBlockedAdd}
                compact
              />
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
                    selectionTotal={cardTotal}
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
                selectionTotal={landTotal}
                isLands
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
