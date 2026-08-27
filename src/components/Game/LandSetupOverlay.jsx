/**
 * LandSetupOverlay — расстановка 4 земель в стиле Card Wars.
 *
 * UX (как в shishkabob27/CardWars Unity):
 *   1. Карты в руке — перетаскиваются на touch и мышью (pointer events).
 *   2. Слоты 1..4 — drop targets + перетаскиваются (обмен местами).
 *   3. Пустой слот + дроп карты — карта встаёт туда.
 *   4. Занятый слот + дроп карты из другого слота — слоты меняются местами.
 *   5. Дроп мимо слотов — snap-back (карта возвращается).
 *   6. Подсветка слота под курсором цветом земли.
 *
 * Отличие от предыдущей версии: вместо HTML5 DnD (который не работает на
 * тач-экранах) используется pointer-events + «призрачная» карта за курсором,
 * как в HUDHand игрового поля.
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

  // Состояние перетаскивания (pointer events, touch-friendly).
  const [dragItem, setDragItem] = useState(null) // { source:'hand'|'slot', index, land }
  const [ghost, setGhost] = useState(null) // { x, y, land }
  const [hoverSlot, setHoverSlot] = useState(null)

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

  const handLands = useMemo(() => {
    const placed = new Set(slots.map((s) => s.land_id).filter(Boolean))
    const candidates = []
    if (me?.deck?.land_deck && Array.isArray(me.deck.land_deck)) {
      candidates.push(...me.deck.land_deck)
    }
    if (me?.deck?.land_cards && Array.isArray(me.deck.land_cards)) {
      candidates.push(...me.deck.land_cards)
    }
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

  // ===== Pointer-based drag (touch + mouse) =====
  const applyDrag = useCallback(
    (targetIndex) => {
      if (dragItem == null || targetIndex == null) return
      if (dragItem.source === 'hand') {
        const land = dragItem.land
        setSlots((prev) => {
          const next = prev.map((r) => ({ ...r }))
          next[targetIndex] = {
            zone_position: targetIndex + 1,
            land_id: land.land_id,
            land_type: land.land_type,
            land_name: land.name,
          }
          return next
        })
      } else {
        const from = dragItem.index
        if (from === targetIndex) return
        setSlots((prev) => {
          const next = prev.map((r) => ({ ...r }))
          const tmp = next[targetIndex]
          next[targetIndex] = next[from]
          next[from] = tmp
          return next
        })
      }
    },
    [dragItem],
  )

  const startHandDrag = useCallback((land, index, e) => {
    if (iAmReady) return
    e.preventDefault()
    setDragItem({ source: 'hand', index, land })
    setGhost({ x: e.clientX, y: e.clientY, land })
  }, [iAmReady])

  const startSlotDrag = useCallback((land, index, e) => {
    if (iAmReady) return
    e.preventDefault()
    setDragItem({ source: 'slot', index, land })
    setGhost({ x: e.clientX, y: e.clientY, land })
  }, [iAmReady])

  useEffect(() => {
    if (!dragItem) return undefined
    const move = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const slotEl = el?.closest?.('[data-slot-index]')
      const idx = slotEl ? Number(slotEl.getAttribute('data-slot-index')) : null
      setHoverSlot(idx)
      setGhost((g) => (g ? { ...g, x: e.clientX, y: e.clientY } : g))
    }
    const up = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const slotEl = el?.closest?.('[data-slot-index]')
      const idx = slotEl ? Number(slotEl.getAttribute('data-slot-index')) : null
      if (idx != null) applyDrag(idx)
      setDragItem(null)
      setGhost(null)
      setHoverSlot(null)
    }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerup', up, { passive: true })
    window.addEventListener('pointercancel', up, { passive: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [dragItem, applyDrag])

  // ===== Submit =====
  const handleConfirm = async () => {
    const landIds = slots.map((s) => s.land_id).filter(Boolean)
    if (landIds.length === SLOT_COUNT) {
      await onReorder?.(landIds)
      await onConfirm?.({ landIds })
    } else {
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
    <div className="land-setup-overlay" role="dialog" aria-modal="true" aria-labelledby="land-setup-title">
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

        <div className="land-setup-slots" role="group" aria-label="Позиции земель">
          {slots.map((row, index) => {
            const { land_type, land_name } = resolveLand(row)
            const isOccupied = Boolean(row.land_id)
            const isHover = hoverSlot === index && dragItem != null
            return (
              <div
                key={`slot-${index}`}
                data-slot-index={index}
                className={`land-setup-slot${isOccupied ? ' is-occupied' : ' is-empty'}${
                  isHover ? ' is-drop-target' : ''
                }${iAmReady ? ' is-locked' : ''}${
                  dragItem?.source === 'slot' && dragItem.index === index ? ' is-dragging' : ''
                }`}
                aria-label={`Позиция ${index + 1}${row.land_id ? `: ${land_name || row.land_id}` : ' — пусто'}`}
              >
                <span className="land-setup-slot-num">{index + 1}</span>
                <LandChip landType={land_type} landName={land_name} isEmpty={!row.land_id} />
                <span className="land-setup-slot-zones">
                  <span className="land-setup-creature">С</span>
                  <span className="land-setup-building">Стр</span>
                </span>
                {isOccupied && !iAmReady && (
                  <div
                    className="land-setup-slot-drag"
                    style={{ touchAction: 'none', cursor: 'grab' }}
                    onPointerDown={(e) =>
                      startSlotDrag(
                        { land_id: row.land_id, land_type, name: land_name },
                        index,
                        e,
                      )
                    }
                    aria-hidden
                  />
                )}
              </div>
            )
          })}
        </div>

        {handLands.length > 0 && !iAmReady && (
          <div className="land-setup-hand" aria-label="Доступные земли">
            <p className="land-setup-hand-label">Рука:</p>
            <div className="land-setup-hand-row">
              {handLands.map((land, idx) => (
                <div
                  key={`hand-${land.land_id}-${idx}`}
                  className="land-setup-hand-card"
                  style={{
                    '--land-fill': getLandPalette(land.land_type).fill,
                    '--land-border': LAND_BORDER_COLOR,
                    touchAction: 'none',
                    cursor: 'grab',
                  }}
                  onPointerDown={(e) => startHandDrag(land, idx, e)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${land.name || getLandPalette(land.land_type).label} (перетащите на слот)`}
                >
                  <span className="land-setup-chip-icon">{LAND_TYPES[land.land_type]?.icon || '🌍'}</span>
                  <span className="land-setup-chip-label">{land.name}</span>
                </div>
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

      {ghost && (
        <div
          className="land-setup-ghost"
          style={{ left: ghost.x, top: ghost.y, pointerEvents: 'none' }}
          aria-hidden
        >
          <LandChip landType={ghost.land.land_type} landName={ghost.land.name} isEmpty={false} />
        </div>
      )}
    </div>
  )
}

export default LandSetupOverlay
