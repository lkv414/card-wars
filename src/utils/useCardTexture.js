/**
 * useCardTexture — Suspense-free версия R3F useLoader для текстур карт.
 *
 * Проблема (RC1 в docs/BUG_RELOAD_DIAGNOSIS.md):
 *   `useLoader` бросает Promise в Suspense при каждой смене URL.
 *   Suspense в GameCanvas.fallback={null} → unmount всей 3D-сцены при
 *   каждом новом URL → «перезагрузка игрового поля».
 *
 * Решение по паттерну testing_3d (SceneObject): текстура подгружается
 * асинхронно через textureCache, но если она не готова — компонент
 * рендерится с placeholder-материалом. Никакого Suspense.
 *
 * Если URL меняется после mount (новые карты приходят из WS-push
 * с другим image_url), мы перезапускаем загрузку. При этом старая
 * текстура остаётся в state до прихода новой — без `setTexture(null)`
 * синхронно в effect (что запрещено правилом
 * react-hooks/set-state-in-effect). Визуально это значит: 1 кадр
 * пользователь видит старую текстуру → 1 кадр placeholder → новая
 * текстура. На практике textureCache возвращает Promise синхронно
 * из кэша (cache.has → return cache.get), поэтому смена URL не
 * вызывает заметного мигания.
 *
 * Текстуры из textureCache.dispose() НЕ вызываются здесь — это
 * ответственность вызывающего (например, при размонтировании всего
 * Canvas через clearTextureCache).
 */
import { useEffect, useState } from 'react'
import * as THREE from 'three'

import { loadCachedTexture, getPlaceholderTextureUrl } from './textureCache.js'

/**
 * Установить корректный colorSpace для текстуры карты.
 * В GameCanvas outputColorSpace = SRGBColorSpace, поэтому текстуры
 * должны быть в sRGB, иначе цвета затемняются (R3F по умолчанию
 * использует NoColorSpace / LinearSRGBColorSpace).
 *
 * Вызывается синхронно после resolve(texture), до setState, чтобы
 * первый кадр с новой текстурой уже был с правильным colorSpace.
 */
function applySRGBColorSpace(texture) {
  if (texture && texture.colorSpace !== THREE.SRGBColorSpace) {
    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true
  }
  return texture
}

/**
 * @param {string|null|undefined} url
 * @returns {THREE.Texture|null} готовая текстура или null (placeholder)
 */
export function useCardTexture(url) {
  const target = url || getPlaceholderTextureUrl()
  const [texture, setTexture] = useState(null)

  useEffect(() => {
    let cancelled = false

    loadCachedTexture(target)
      .then((tex) => {
        if (cancelled) return
        setTexture(applySRGBColorSpace(tex))
      })
      .catch(() => {
        // Ошибку тихо игнорируем — GameObject покажет placeholder.
        if (cancelled) return
      })

    return () => {
      cancelled = true
    }
  }, [target])

  return texture
}
