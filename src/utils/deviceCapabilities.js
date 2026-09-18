/**
 * deviceCapabilities — профиль устройства для настроек рендера.
 *
 * По паттерну skills/3d-web-experience: на мобильных ограничиваем DPR и
 * выключаем MSAA — это даёт кратный прирост FPS ценой малозаметной потери
 * резкости. Решение принимается один раз за сессию (модульный кэш), потому что
 * опрос matchMedia/UA на каждый рендер — лишняя работа в горячем пути.
 */

const MOBILE_UA =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|BB10|IEMobile|Opera Mini|Mobile|Silk/i

function matchCoarsePointer() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

let cached = null

/**
 * @returns {{ isMobile: boolean, maxDpr: number, antialias: boolean }}
 */
export function detectDeviceProfile() {
  if (cached) return cached

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
  const touchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0
  const minSide =
    typeof window !== 'undefined'
      ? Math.min(window.innerWidth || 0, window.innerHeight || 0)
      : 0

  const uaMobile = MOBILE_UA.test(ua)
  // Планшет/телефон без мобильного UA (iPadOS desktop mode) ловим по
  // coarse pointer + маленькой стороне экрана.
  const coarseMobile = matchCoarsePointer() && touchPoints > 0 && minSide > 0 && minSide <= 900
  const isMobile = uaMobile || coarseMobile

  cached = {
    isMobile,
    maxDpr: isMobile ? 1.5 : 2,
    antialias: !isMobile,
  }
  return cached
}

/** Только для тестов: сбросить модульный кэш. */
export function __resetDeviceProfile() {
  cached = null
}
