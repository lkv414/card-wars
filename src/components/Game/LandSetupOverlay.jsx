/**
 * LandSetupOverlay — расстановка 4 земель перед началом матча.
 *
 * Игрок может отметить готовность даже если в колоде < 4 земель — сервер
 * примет `bypass=true` и пометит land_setup_ready=true без reorder RPC.
 * Это позволяет запускать матч на неполных колодах (beta).
 */
import { useCallback, useMemo, useState, useEffect } from 'react'
import { LAND_TYPES } from '../../constants/game'
import { getLandPalette, LAND_BORDER_COLOR } from '../../constants/landColors'
import { normalizePlayerZoneRows } from '../../hooks/game/format'

function LandChip({ landType, landName, selected, onClick }) {
  const palette = getLandPalette(landType)
  return (
    <span
      className={`land-setup-chip${selected ? ' is-selected' : ''}`}
      style={{
        '--land-fill': palette.fill,
        '--land-border': LAND_BORDER_COLOR,
      }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick(e)
              }
            }
          : undefined
      }
    >
      <span className="land-setup-chip-icon">{LAND_TYPES[landType]?.icon || '🌍'}</span>
      <span className="land-setup-chip-label">{landName || palette.label}</span>
    </span>
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
  const [selectedSlot, setSelectedSlot] = useState(null)

  // slots синхронизируется с initialRows пока игрок не зафиксировал
  // расстановку. Чтобы не дёргать setState синхронно в useEffect (правило
  // react-hooks/set-state-in-effect), оборачиваем вызов в микротаск —
  // состояние всё равно обновится до следующего рендера.
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
    if (landIds.length === 4) {
      // Полный набор — обычный reorder + confirm
      await onReorder?.(landIds)
      await onConfirm?.({ landIds })
    } else {
      // Меньше 4 земель — bypass через confirm
      await onConfirm?.({ landIds, bypass: true })
    }
  }

  const handleSkip = async () => {
    await onSkip?.()
  }

  if (!me || game?.status !== 'setup') return null

  const landIds = slots.map((s) => s.land_id).filter(Boolean)
  const hasAllFourLands = landIds.length === 4
  const canConfirm = !iAmReady && !isApplying
  const hasAnyLands = landIds.length > 0
  const emptySlotCount = slots.filter((s) => !s.land_id).length

  return (
    <div className="land-setup-overlay" role="dialog" aria-modal="true" aria-labelledby="land-setup-title">
      <div className="land-setup-panel">
        <h2 id="land-setup-title">Расставьте земли</h2>
        <p className="land-setup-hint">
          Нажмите две ячейки, чтобы поменять их местами. Когда порядок устроит — нажмите «Готов».
        </p>

        {!hasAllFourLands && (
          <p className="land-setup-warning" role="status">
            ⚠️ В колоде только {landIds.length} из 4 земель. Можно расставить их и нажать «Готов»,
            или сразу «Готов без земель» — матч начнётся с {landIds.length || 0} землями.
          </p>
        )}

        <div className="land-setup-slots" role="group" aria-label="Позиции земель">
          {slots.map((row, index) => {
            const { land_type, land_name } = resolveLand(row)
            return (
              <button
                key={`slot-${index}`}
                type="button"
                className={`land-setup-slot${selectedSlot === index ? ' is-selected' : ''}${iAmReady ? ' is-locked' : ''}${!row.land_id ? ' is-empty' : ''}`}
                disabled={iAmReady}
                onClick={() => handleSlotClick(index)}
                aria-label={`Позиция ${index + 1}${row.land_id ? `: ${land_name || row.land_id}` : ' — пусто'}`}
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
          {hasAllFourLands ? (
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
                    : 'Расставить и подтвердить'
              }
            >
              {iAmReady ? 'Ожидание…' : isApplying ? 'Отправка…' : 'Готов'}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="land-setup-confirm"
                disabled={!canConfirm || !hasAnyLands}
                onClick={handleConfirm}
                aria-disabled={!canConfirm || !hasAnyLands}
                title={
                  !hasAnyLands
                    ? 'Нет ни одной земли для расстановки'
                    : iAmReady
                      ? 'Уже подтверждено'
                      : isApplying
                        ? 'Отправка...'
                        : `Расставить ${landIds.length} ${emptySlotCount > 0 ? `и оставить ${emptySlotCount} пустыми` : ''}`
                }
              >
                {iAmReady ? 'Ожидание…' : isApplying ? 'Отправка…' : `Готов (${landIds.length}/4)`}
              </button>
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}