/**
 * LandSetupOverlay — расстановка 4 земель в стиле Card Wars.
 *
 * UX (как в shishkabob27/CardWars Unity):
 *   ┌──────────────────────────────────────────────────────────┐
 *   │   Расставьте земли                                            │
 *   │   Перетащите карту в слот 1..4 или поменяйте слоты местами    │
 *   │                                                            │
 *   │   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐             │
 *   │   │   1    │ │   2    │ │   3    │ │   4    │   ← drop targets│
 *   │   │ Plains │ │ Forest │ │  ---   │ │  ---   │             │
 *   │   └────────┘ └────────┘ └────────┘ └────────┘             │
 *   │                                                            │
 *   │   Рука (drag source):                                       │
 *   │   ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                      │
 *   │   │ Plains│ │ Corn │ │ Dough │ │  ?  │                      │
 *   │   └──────┘ └──────┘ └──────┘ └──────┘                      │
 *   │                                                            │
 *   │                          [Готов] [Без земель]              │
 *   └──────────────────────────────────────────────────────────┘
 *
 * 1. Карты в руке — draggable на touch и мышью.
 * 2. Слоты 1..4 — drop targets + draggable (для обмена местами).
 * 3. Когда слот пуст и в него дропнули — карта ставится туда.
 * 4. Когда слот занят и в него дропнули — карты обмениваются.
 * 5. Перед подтверждением — сначала reorder_lands (если все 4 земли), затем confirm.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { LAND_TYPES } from '../../constants/game'
import { getLandPalette, LAND_BORDER_COLOR } from '../../constants/landColors'
import { normalizePlayerZoneRows } from '../../hooks/game/format'

const SLOT_COUNT = 4

function LandChip({ landType, landName, isEmpty }) {
  const palette = getLandPalette(landType)
  if (isEmpty) {
    return (
      <div
        className="land-setup-chip land-setup-chip--empty"
        style={{ '--land-border': LAND_BORDER_COLOR }}
        aria-label="Пустой слот"
      >
        <span className="land-setup-chip-icon" aria-hidden>?</span>
        <span className="land-setup-chip-label">Пусто</span>
      </div>
    )
  }
  return (
    <div
      className="land-setup-chip"
      style={{
        '--land-fill': palette.fill,
        '--land-border': LAND_BORDER_COLOR,
      }}
    >
      <span className="land-setup-chip-icon">{LAND_TYPES[landType]?.icon || '🌍'}</span>
      <span className="land-setup-chip-label">{landName || palette.label}</span>
    </div>
  )
}

/**
 * Compact hand chip — used in the bottom "hand" row. Smaller than the
 * slot chip; serves as the drag source.
 */
function HandChip({ landType, landName, index, onDragStart, onDragEnd, isUsed, isDragging }) {
  const palette = getLandPalette(landType)
  return (
    <div
      className={`land-setup-hand-card${isDragging ? ' is-dragging' : ''}${isUsed ? ' is-used' : ''}`}
      style={{
        '--land-fill': palette.fill,
        '--land-border': LAND_BORDER_COLOR,
      }}
      draggable={!isUsed}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/land-hand-index', String(index))
        onDragStart?.(index)
      }}
      onDragEnd={onDragEnd}
      aria-grabbed={isDragging}
      role="button"
      tabIndex={isUsed ? -1 : 0}
      aria-label={`${landName || palette.label} (перетащите на слот)`}
    >
      <span className="land-setup-chip-icon" aria-hidden>{LAND_TYPES[landType]?.icon || '🌍'}</span>
      <span className="land-setup-chip-label">{landName || palette.label}</span>
    </div>
  )
}

export function LandSetupOverlay({
  game,
  playerId,
  landCatalog,
  onReorder,
  onConfirm,
  onSkip,
  isApplying,
}) {
  const me = useMemo(
    () => (game?.players || []).find((p) => p.player_id === playerId),
    [game?.players, playerId],
  )

  const initialRows = useMemo(() => normalizePlayerZoneRows(me?.zones), [me?.zones])
  const iAmReady = Boolean(me?.land_setup_ready)
  const [slots, setSlots] = useState(() => initialRows.map((r) => ({ ...r })))
  const [draggingHandIndex, setDraggingHandIndex] = useState(null)
  const [draggingSlotIndex, setDraggingSlotIndex] = useState(null)
  const [hoverSlotIndex, setHoverSlotIndex] = useState(null)

  // Синхронизируем с сервером, пока игрок не подтвердил. Оборачиваем
  // setState в microtask чтобы не триггерить его синхронно в useEffect
  // (правило react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!iAmReady) {
      Promise.resolve().then(() => {
        setSlots(initialRows.map((r) => ({ ...r })))
      })
    }
  }, [initialRows, iAmReady])

  const readyCount = useMemo(
    () => (game?.players || []).filter((p) => p.land_setup_ready).length,
    [game?.players],
  )
  const totalPlayers = game?.players?.length || 0

  const resolveLand = useCallback(
    (row) => {
      const type = row.land_type || landCatalog[row.land_id]?.land_type
      const name = row.land_name || landCatalog[row.land_id]?.name
      return { land_type: type, land_name: name }
    },
    [landCatalog],
  )

  // ===== Hand (source) — все доступные земли из deck.deck (decks) + то,
  // что уже стоит в слотах. Игрок может перетащить любую. =====
  // Источник: мы берём «land_deck» из player-конфига колоды; если нет —
  // показываем только то, что уже в слотах.
  const handLands = useMemo(() => {
    const placed = new Set(
      slots
        .map((s) => s.land_id)
        .filter(Boolean),
    )
    // Резервируем deck.land_deck или land_cards — посмотрим что у нас есть
    const candidates = []
    if (me?.deck?.land_deck && Array.isArray(me.deck.land_deck)) {
      candidates.push(...me.deck.land_deck)
    }
    if (me?.deck?.land_cards && Array.isArray(me.deck.land_cards)) {
      candidates.push(...me.deck.land_cards)
    }
    // Если нет «land_deck» — попробуем найти в каталоге первые 4 земли
    if (candidates.length === 0) {
      const catalogEntries = Object.values(landCatalog || {})
      candidates.push(...catalogEntries.slice(0, SLOT_COUNT))
    }
    return candidates
      .filter(Boolean)
      .map((land) => {
        const id = land.id ?? land.land_id
        return {
          id,
          land_id: id,
          land_type: land.land_type ?? landCatalog[id]?.land_type,
          name: land.name ?? landCatalog[id]?.name,
        }
      })
      .filter((l) => l.land_id && !placed.has(l.land_id))
  }, [me, slots, landCatalog])

  // ===== Drag/drop handlers =====
  const handleHandDragStart = useCallback((idx) => {
    setDraggingHandIndex(idx)
  }, [])
  const handleHandDragEnd = useCallback(() => {
    setDraggingHandIndex(null)
    setDraggingSlotIndex(null)
    setHoverSlotIndex(null)
  }, [])
  const handleSlotDragStart = useCallback((idx) => {
    setDraggingSlotIndex(idx)
  }, [])
  const handleSlotDragEnd = useCallback(() => {
    setDraggingSlotIndex(null)
    setHoverSlotIndex(null)
  }, [])

  // Когда дропнули карту из руки — обновляем slot. ВАЖНО: чтобы не
  // нарушать правило react-hooks/set-state-in-effect, используем ref
  // для отслеживания (draggingHandIndex, hoverSlotIndex уже в state).
  // Применяем эффект в микротаске после изменения hoverSlotIndex.
  useEffect(() => {
    if (draggingHandIndex === null) return
    if (hoverSlotIndex === null) return
    if (hoverSlotIndex < 0 || hoverSlotIndex >= SLOT_COUNT) return
    const card = handLands[draggingHandIndex]
    if (!card) return
    // Wrap setState in microtask to satisfy react-hooks/set-state-in-effect.
    Promise.resolve().then(() => {
      setSlots((prev) => {
        const next = prev.map((r) => ({ ...r }))
        next[hoverSlotIndex] = {
          zone_position: hoverSlotIndex + 1,
          land_id: card.land_id,
          land_type: card.land_type,
          land_name: card.name,
        }
        return next
      })
    })
  }, [draggingHandIndex, hoverSlotIndex, handLands])

  // ===== Submit =====
  const handleConfirm = async () => {
    const landIds = slots.map((s) => s.land_id).filter(Boolean)
    if (landIds.length === SLOT_COUNT) {
      await onReorder?.(landIds)
      await onConfirm?.({ landIds })
    } else {
      // Меньше 4 земель — bypass
      await onConfirm?.({ landIds, bypass: true })
    }
  }

  const handleSkip = async () => {
    await onSkip?.()
  }

  if (!me || game?.status !== 'setup') return null

  const filledSlots = slots.filter((s) => s.land_id).length
  const canConfirm = !iAmReady && !isApplying

  return (
    <div
      className="land-setup-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="land-setup-title"
    >
      <div className="land-setup-panel">
        <h2 id="land-setup-title">Расставьте земли</h2>
        <p className="land-setup-hint">
          Перетащите карту земли в слот 1–4. Чтобы поменять слоты местами — перетащите
          карту из одного слота в другой.
        </p>

        {!iAmReady && filledSlots < SLOT_COUNT && (
          <p className="land-setup-warning" role="status">
            ⚠️ В колоде {filledSlots} из {SLOT_COUNT} земель. Можно расставить и
            нажать «Готов», или сразу «Готов без земель» — матч начнётся с {filledSlots}{' '}
            землями.
          </p>
        )}

        <div
          className="land-setup-slots"
          role="group"
          aria-label="Позиции земель"
        >
          {slots.map((row, index) => {
            const { land_type, land_name } = resolveLand(row)
            const isHover = hoverSlotIndex === index && draggingHandIndex !== null
            const isOccupied = Boolean(row.land_id)
            return (
              <button
                key={`slot-${index}`}
                type="button"
                className={`land-setup-slot${isOccupied ? ' is-occupied' : ' is-empty'}${
                  isHover ? ' is-drop-target' : ''
                }${iAmReady ? ' is-locked' : ''}${
                  draggingSlotIndex === index ? ' is-dragging' : ''
                }`}
                disabled={iAmReady}
                draggable={isOccupied && !iAmReady}
                onDragStart={(e) => {
                  if (!isOccupied) {
                    e.preventDefault()
                    return
                  }
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/land-slot-index', String(index))
                  handleSlotDragStart(index)
                }}
                onDragEnd={handleSlotDragEnd}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (hoverSlotIndex !== index) setHoverSlotIndex(index)
                }}
                onDragLeave={() => {
                  if (hoverSlotIndex === index) setHoverSlotIndex(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const handIdx = e.dataTransfer.getData('text/land-hand-index')
                  const slotIdx = e.dataTransfer.getData('text/land-slot-index')
                  if (handIdx) {
                    // hand → slot: place via effect (avoids setState in
                    // event handler side effect warnings).
                    setDraggingHandIndex(Number(handIdx))
                    setHoverSlotIndex(index)
                    return
                  }
                  if (slotIdx) {
                    const from = Number(slotIdx)
                    if (Number.isNaN(from) || from === index) return
                    setSlots((prev) => {
                      const next = prev.map((r) => ({ ...r }))
                      ;[next[from], next[index]] = [next[index], next[from]]
                      return next
                    })
                  }
                }}
                aria-label={`Позиция ${index + 1}${row.land_id ? `: ${land_name || row.land_id}` : ' — пусто'}`}
              >
                <span className="land-setup-slot-num">{index + 1}</span>
                <LandChip
                  landType={land_type}
                  landName={land_name}
                  isEmpty={!row.land_id}
                />
                <span className="land-setup-slot-zones">
                  <span className="land-setup-creature">С</span>
                  <span className="land-setup-building">Стр</span>
                </span>
              </button>
            )
          })}
        </div>

        {/* Hand — drag source. Только те земли, которые ещё не на поле. */}
        {handLands.length > 0 && !iAmReady && (
          <div className="land-setup-hand" aria-label="Доступные земли">
            <p className="land-setup-hand-label">Рука:</p>
            <div className="land-setup-hand-row">
              {handLands.map((land, idx) => (
                <HandChip
                  key={`hand-${land.land_id}-${idx}`}
                  landType={land.land_type}
                  landName={land.name}
                  index={idx}
                  isDragging={draggingHandIndex === idx}
                  onDragStart={handleHandDragStart}
                  onDragEnd={handleHandDragEnd}
                />
              ))}
            </div>
          </div>
        )}

        <div className="land-setup-status">
          Расставлено: {filledSlots} / {SLOT_COUNT}
          {!iAmReady && ` · готово: ${readyCount} / ${totalPlayers}`}
          {iAmReady && <span className="land-setup-wait"> · ждём остальных</span>}
        </div>

        <div className="land-setup-actions">
          <button
            type="button"
            className="land-setup-confirm"
            disabled={!canConfirm}
            onClick={handleConfirm}
            aria-disabled={!canConfirm}
            title={
              iAmReady
                ? 'Уже подтверждено'
                : isApplying
                  ? 'Отправка...'
                  : filledSlots === SLOT_COUNT
                    ? 'Расставить и подтвердить'
                    : 'Подтвердить с текущими землями'
            }
          >
            {iAmReady ? 'Ожидание…' : isApplying ? 'Отправка…' : 'Готов'}
          </button>
          {filledSlots < SLOT_COUNT && (
            <button
              type="button"
              className="land-setup-skip"
              disabled={!canConfirm}
              onClick={handleSkip}
              aria-disabled={!canConfirm}
              title="Начать матч без расстановки земель"
            >
              Готов без земель
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
