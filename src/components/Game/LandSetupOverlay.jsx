/**
 * LandSetupOverlay — расстановка 4 земель перед началом матча.
 */
import { useCallback, useMemo, useState, useEffect } from 'react'
import { LAND_TYPES } from '../../constants/game'
import { getLandPalette, LAND_BORDER_COLOR } from '../../constants/landColors'
import { normalizePlayerZoneRows } from '../../hooks/game/format'

function LandChip({ landType, landName, selected, onClick }) {
  const palette = getLandPalette(landType)
  return (
    <button
      type="button"
      className={`land-setup-chip${selected ? ' is-selected' : ''}`}
      style={{
        '--land-fill': palette.fill,
        '--land-border': LAND_BORDER_COLOR,
      }}
      onClick={onClick}
    >
      <span className="land-setup-chip-icon">{LAND_TYPES[landType]?.icon || '🌍'}</span>
      <span className="land-setup-chip-label">{landName || palette.label}</span>
    </button>
  )
}

export function LandSetupOverlay({
  game,
  playerId,
  landCatalog,
  onReorder,
  onConfirm,
  isApplying,
}) {
  const me = useMemo(
    () => (game?.players || []).find((p) => p.player_id === playerId),
    [game?.players, playerId]
  )

  const initialRows = useMemo(() => normalizePlayerZoneRows(me?.zones), [me?.zones])
  const iAmReady = Boolean(me?.land_setup_ready)
  const [slots, setSlots] = useState(() => initialRows.map((r) => ({ ...r })))
  const [selectedSlot, setSelectedSlot] = useState(null)

  useEffect(() => {
    if (!iAmReady) {
      setSlots(initialRows.map((r) => ({ ...r })))
    }
  }, [initialRows, iAmReady])

  const readyCount = useMemo(
    () => (game?.players || []).filter((p) => p.land_setup_ready).length,
    [game?.players]
  )
  const totalPlayers = game?.players?.length || 0

  const resolveLand = useCallback(
    (row) => {
      const type = row.land_type || landCatalog[row.land_id]?.land_type
      const name = row.land_name || landCatalog[row.land_id]?.name
      return { land_type: type, land_name: name }
    },
    [landCatalog]
  )

  const swapSlots = (from, to) => {
    if (from === to) return
    setSlots((prev) => {
      const next = [...prev]
      ;[next[from], next[to]] = [next[to], next[from]]
      return next
    })
    setSelectedSlot(null)
  }

  const handleSlotClick = (index) => {
    if (iAmReady) return
    if (selectedSlot === null) {
      setSelectedSlot(index)
      return
    }
    swapSlots(selectedSlot, index)
  }

  const handleConfirm = async () => {
    const landIds = slots.map((s) => s.land_id).filter(Boolean)
    if (landIds.length !== 4) return
    await onReorder?.(landIds)
    await onConfirm?.()
  }

  if (!me || game?.status !== 'setup') return null

  return (
    <div className="land-setup-overlay" role="dialog" aria-modal="true" aria-labelledby="land-setup-title">
      <div className="land-setup-panel">
        <h2 id="land-setup-title">Расставьте земли</h2>
        <p className="land-setup-hint">
          Нажмите две ячейки, чтобы поменять их местами. Когда порядок устроит — нажмите «Готов».
        </p>

        <div className="land-setup-slots" role="group" aria-label="Позиции земель">
          {slots.map((row, index) => {
            const { land_type, land_name } = resolveLand(row)
            return (
              <button
                key={`slot-${index}`}
                type="button"
                className={`land-setup-slot${selectedSlot === index ? ' is-selected' : ''}${iAmReady ? ' is-locked' : ''}`}
                disabled={iAmReady}
                onClick={() => handleSlotClick(index)}
              >
                <span className="land-setup-slot-num">{index + 1}</span>
                <LandChip landType={land_type} landName={land_name} />
                <span className="land-setup-slot-zones">
                  <span className="land-setup-creature">Существо</span>
                  <span className="land-setup-building">Строение</span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="land-setup-status">
          Готовы: {readyCount} / {totalPlayers}
          {iAmReady && <span className="land-setup-wait"> · ждём остальных</span>}
        </div>

        <div className="land-setup-actions">
          <button
            type="button"
            className="land-setup-confirm"
            disabled={iAmReady || isApplying || slots.some((s) => !s.land_id)}
            onClick={handleConfirm}
          >
            {iAmReady ? 'Ожидание…' : 'Готов'}
          </button>
        </div>
      </div>
    </div>
  )
}
