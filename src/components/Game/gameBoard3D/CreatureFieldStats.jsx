import { Html } from '@react-three/drei'
import { getCardAttack, getCardHealth } from '../../../utils/cardFields.ts'
import { isCreatureCard } from '../../../hooks/game/combat'

/** HP/ATK бейдж на существе на поле (без drei Text — не перекрывает текстуру). */
export function CreatureFieldStats({ card, slot, rotationY = 0 }) {
  if (!card || !isCreatureCard(card)) return null
  const hp = getCardHealth(card)
  const atk = getCardAttack(card)
  if (hp == null && atk == null) return null

  return (
    <Html
      position={[slot.x, 0.22, slot.z]}
      rotation={[0, -rotationY, 0]}
      center
      distanceFactor={8}
      style={{ pointerEvents: 'none', userSelect: 'none', background: 'transparent' }}
      className="creature-field-stats-html"
    >
      <div className="creature-field-stats">
        {atk != null && <span className="creature-field-stats-atk">⚔️{atk}</span>}
        {hp != null && <span className="creature-field-stats-hp">❤️{hp}</span>}
      </div>
    </Html>
  )
}
