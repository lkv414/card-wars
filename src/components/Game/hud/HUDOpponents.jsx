import { INITIAL_HEALTH } from '../../../constants/gameMultiplayer'

export function HUDOpponents({ players, myPlayerId }) {
  const opponents = (players || []).filter((p) => p.player_id !== myPlayerId)

  if (opponents.length === 0) return null

  return (
    <div className="hud-opponents" aria-label="Противники">
      {opponents.map((opp) => (
        <div key={opp.player_id} className="hud-opponent-chip">
          <span className="hud-opponent-name">{opp.nickname || 'Игрок'}</span>
          <span className="hud-opponent-stats">
            ❤️ {opp.health ?? 0}/{INITIAL_HEALTH}
          </span>
          <span className="hud-opponent-stats">🂠 × {opp.hand?.length ?? 0}</span>
          {(opp.health ?? 0) <= 0 && <span className="hud-opponent-dead">OUT</span>}
        </div>
      ))}
    </div>
  )
}
