import { logError } from '../../../utils/errorLogger'

export function HUDDropZones({
  me,
  draggingCardIndex,
  isApplying,
  onPlayCard,
  onDragEnd,
  onJustPlayed,
}) {
  if (draggingCardIndex === null) return null

  return (
    <div className="hud-drop-zones" role="group" aria-label="Земли для размещения">
      {[0, 1, 2, 3].map((idx) => {
        const zone = me?.zones?.[idx] || {}
        const cards = Array.isArray(zone) ? zone : zone.cards || []
        const isEmpty = !Array.isArray(cards) || cards.length === 0
        let wasDragged = false

        const handleDrop = (e) => {
          e.stopPropagation()
          e.preventDefault()
          if (isApplying) return
          wasDragged = true
          if (!isEmpty || draggingCardIndex === null) return
          onDragEnd()
          if (typeof onPlayCard === 'function') {
            onJustPlayed(draggingCardIndex, idx)
            Promise.resolve(onPlayCard(draggingCardIndex, idx, 1)).catch((err) => {
              logError(err, { component: 'HUDDropZones', action: 'playCard' })
            })
          }
        }

        const handleClick = (e) => {
          if (wasDragged) return
          handleDrop(e)
        }

        return (
          <button
            type="button"
            key={`drop-zone-${idx}`}
            className={`hud-drop-zone${isEmpty ? ' empty' : ' full'}`}
            disabled={!isEmpty}
            onClick={handleClick}
            onDragOver={(e) => {
              e.stopPropagation()
              e.preventDefault()
            }}
            onDrop={handleDrop}
            onDragEnd={() => {
              wasDragged = true
              setTimeout(() => {
                wasDragged = false
              }, 100)
            }}
            title={isEmpty ? `Разместить на земле ${idx + 1}` : 'Земля занята'}
            aria-label={isEmpty ? `Земля ${idx + 1}, свободна` : `Земля ${idx + 1}, занята`}
          >
            <span className="hud-drop-zone-num">{idx + 1}</span>
            <span className="hud-drop-zone-label">{isEmpty ? 'Свободно' : 'Занято'}</span>
          </button>
        )
      })}
    </div>
  )
}
