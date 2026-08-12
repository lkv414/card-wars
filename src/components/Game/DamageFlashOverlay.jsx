/** Красная вспышка при уроне по игроку. */
export function DamageFlashOverlay({ active }) {
  if (!active) return null
  return <div className="damage-flash-overlay" aria-hidden />
}
