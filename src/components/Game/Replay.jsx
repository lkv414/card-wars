import { useEffect, useMemo, useRef, useState } from 'react'
import { getReplayEntry, normalizeReplayLog } from '../../utils/replayLog'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import './Replay.css'

export function Replay({ log, onClose }) {
  const entries = useMemo(() => normalizeReplayLog(log), [log])
  const [stepIndex, setStepIndex] = useState(() => Math.max(entries.length - 1, 0))
  const dialogRef = useRef(null)
  useFocusTrap(true, dialogRef)

  const lastIndex = Math.max(entries.length - 1, 0)
  const activeIndex = Math.min(stepIndex, lastIndex)

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
      if (event.key === 'ArrowLeft') {
        setStepIndex((current) => Math.max(current - 1, 0))
      }
      if (event.key === 'ArrowRight') {
        setStepIndex((current) => Math.min(current + 1, Math.max(entries.length - 1, 0)))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [entries.length, onClose])

  const entry = getReplayEntry(entries, activeIndex)
  const entryDate = entry ? new Date(entry.timestamp) : null
  const hasValidTimestamp = entryDate && !Number.isNaN(entryDate.getTime())

  return (
    <div className="replay-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="replay-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="replay-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="replay-header">
          <div>
            <h2 id="replay-title">Реплей партии</h2>
            <p>Просмотр сохранённого журнала действий</p>
          </div>
          <button className="replay-close" onClick={onClose} aria-label="Закрыть реплей">×</button>
        </header>

        {entry ? (
          <>
            <div className="replay-step-card">
              <span className="replay-step-number">Шаг {entry.step} из {entries.length}</span>
              {hasValidTimestamp && (
                <time dateTime={entryDate.toISOString()}>
                  {entryDate.toLocaleTimeString()}
                </time>
              )}
              <strong>{entry.message}</strong>
            </div>

            <input
              className="replay-slider"
              type="range"
              min="0"
              max={entries.length - 1}
              value={activeIndex}
              onChange={(event) => setStepIndex(Number(event.target.value))}
              aria-label="Шаг реплея"
            />

            <div className="replay-controls">
              <button onClick={() => setStepIndex(0)} disabled={activeIndex === 0}>В начало</button>
              <button onClick={() => setStepIndex((current) => Math.max(current - 1, 0))} disabled={activeIndex === 0}>← Назад</button>
              <button onClick={() => setStepIndex((current) => Math.min(current + 1, entries.length - 1))} disabled={activeIndex === entries.length - 1}>Вперёд →</button>
              <button onClick={() => setStepIndex(entries.length - 1)} disabled={activeIndex === entries.length - 1}>В конец</button>
            </div>

            <ol className="replay-timeline">
              {entries.map((item, index) => (
                <li key={`replay-step-${item.step}`} className={`${index === activeIndex ? 'active' : ''}${item.type === 'battle' ? ' replay-step--battle' : ''}`}>
                  <button onClick={() => setStepIndex(index)}>
                    <span>{item.step}</span>
                    {item.type === 'battle' && <span className="replay-badge">⚔️</span>}
                    {item.message}
                  </button>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <div className="replay-empty">В этой партии пока нет записанных действий.</div>
        )}
      </section>
    </div>
  )
}

export default Replay
