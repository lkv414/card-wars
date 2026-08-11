export function HUDHand({
  handCards,
  isYourTurn,
  isFinished,
  isApplying,
  selectedCardIndex,
  setSelectedCardIndex,
  draggingCardIndex,
  setDraggingCardIndex,
  justPlayedCardIndex,
  onPlayCard,
}) {
  return (
    <div className="hud-hand" role="list" aria-label="Ваша рука">
      {Array.isArray(handCards) && handCards.length > 0 ? (
        handCards.map((c, idx) => {
          const isSel = selectedCardIndex === idx
          const isDragging = draggingCardIndex === idx
          return (
            <button
              type="button"
              key={c?.id || c?.instanceId || idx}
              className={`hud-hand-card${isSel ? ' selected' : ''}${isDragging ? ' dragging' : ''}${justPlayedCardIndex === idx ? ' just-played' : ''}${isYourTurn ? '' : ' disabled'}`}
              disabled={!isYourTurn || isFinished}
              draggable={Boolean(isYourTurn && !isFinished && onPlayCard)}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                setSelectedCardIndex(isSel ? null : idx)
              }}
              onDragStart={(e) => {
                if (!isYourTurn || isFinished || isApplying) {
                  e.preventDefault()
                  return
                }
                setDraggingCardIndex(idx)
                setSelectedCardIndex(idx)
                e.dataTransfer.setData('text/plain', String(idx))
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => setDraggingCardIndex(null)}
              onPointerDown={() => {
                if (isYourTurn && !isFinished) {
                  setSelectedCardIndex(isSel ? null : idx)
                }
              }}
              aria-pressed={isSel}
              aria-label={c?.name ?? `Карта ${idx + 1}`}
              title={c?.name || `Карта ${idx + 1}`}
            >
              {c?.image_url ? (
                <img
                  src={c.image_url}
                  alt=""
                  className="hud-hand-card-img"
                  draggable={false}
                />
              ) : (
                <span className="hud-hand-card-fallback">{c?.name || `Карта ${idx + 1}`}</span>
              )}
            </button>
          )
        })
      ) : (
        <div className="hud-hand-empty">Рука пуста</div>
      )}
    </div>
  )
}
