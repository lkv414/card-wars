/** Side indicator overlay — shows which side of the table is yours. */
export function PlayerSideIndicator({ playerCount, myIndex }) {
  if (playerCount < 2 || myIndex < 0) return null

  const labels = {
    2: ['Юг (вы)', 'Север'],
    3: ['Запад (вы)', 'Северо-восток', 'Юго-восток'],
    4: ['Запад (вы)', 'Север', 'Восток', 'Юг'],
  }
  const sides = labels[playerCount] || []
  const myLabel = sides[myIndex] || 'Ваша сторона'

  return (
    <div className="player-side-indicator" aria-label={`Ваша сторона: ${myLabel}`}>
      <span className="player-side-indicator-icon" aria-hidden>📍</span>
      <span className="player-side-indicator-text">{myLabel}</span>
    </div>
  )
}
