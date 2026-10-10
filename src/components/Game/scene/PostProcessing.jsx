/**
 * PostProcessing — эффекты пост-обработки для кинематографичного вида.
 *
 * Эффекты:
 * - Bloom: свечение ярких элементов (Selected cards, damage flashes)
 * - Vignette: затемнение краёв для фокуса на центре
 * - ToneMapping: ACES Filmic для кинематографичных цветов
 *
 * На слабых устройствах эффекты отключаются через detectDeviceProfile.
 */
import { useMemo } from 'react'
import { EffectComposer, Bloom, Vignette, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { useThree } from '@react-three/fiber'

import { detectDeviceProfile } from '../../../utils/deviceCapabilities'

export function PostProcessing({ enabled = true }) {
  const { gl } = useThree()
  const { isMobile, isLowEnd } = detectDeviceProfile()

  // На слабых устройствах отключаем дорогие эффекты
  const effects = useMemo(() => {
    if (!enabled || isLowEnd) return []

    return [
      // Bloom для свечения ярких элементов
      <Bloom
        key="bloom"
        intensity={isMobile ? 0.15 : 0.3}
        luminanceThreshold={0.85}
        luminanceSmoothing={0.3}
        mipmapBlur
      />,
      // Vignette для кинематографичности
      <Vignette
        key="vignette"
        darkness={isMobile ? 0.25 : 0.35}
        offset={0.3}
      />,
      // ToneMapping для кинематографичных цветов
      <ToneMapping
        key="tonemapping"
        mode={ToneMappingMode.ACES_FILMIC}
      />,
    ]
  }, [enabled, isMobile, isLowEnd])

  if (effects.length === 0) return null

  return (
    <EffectComposer multisampling={isMobile ? 0 : 4}>
      {effects}
    </EffectComposer>
  )
}

export default PostProcessing
