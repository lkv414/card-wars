/**
 * GamePanel — HUD overlay, рендерится ВНЕ Canvas.
 *
 * По паттерну testing_3d (ScenePanel): aside с position absolute, кнопки и списки.
 * Только DOM, никакого R3F. Делегирует рендер существующему HUDOverlay.
 */
import { HUDOverlay } from '../HUDOverlay'

/**
 * @param {object} props — все пропсы передаются в HUDOverlay
 */
export function GamePanel(props) {
  return <HUDOverlay {...props} />
}

export default GamePanel
