export const CARD_ZOOM_SCALE = 2.85
export const CARD_ZOOM_SCALE_COMPACT = 3.1
const EDGE_PAD = 4

function rectBounds(rect, pad = EDGE_PAD) {
  return {
    left: rect.left + pad,
    right: rect.right - pad,
    top: rect.top + pad,
    bottom: rect.bottom - pad,
  }
}

export function getZoomBounds(el) {
  const library = el.closest('.deck-library')

  if (!library) {
    const grid = el.closest('.cards-grid')
    if (!grid) return null
    return rectBounds(grid.getBoundingClientRect())
  }

  const lib = library.getBoundingClientRect()
  const toolbar = library.querySelector('.library-toolbar')
  const dock = el.closest('.deck-builder')?.querySelector('.deck-dock')

  let top = lib.top + EDGE_PAD
  if (toolbar) {
    top = Math.max(top, toolbar.getBoundingClientRect().bottom + EDGE_PAD)
  }

  let bottom = lib.bottom - EDGE_PAD
  if (dock) {
    const dockTop = dock.getBoundingClientRect().top
    if (Number.isFinite(dockTop)) {
      bottom = Math.min(bottom, dockTop - EDGE_PAD)
    }
  }

  return {
    left: lib.left + EDGE_PAD,
    right: lib.right - EDGE_PAD,
    top,
    bottom,
  }
}

export function clampOrigin(min, max, preferred = 0.5) {
  if (min <= max) return Math.max(min, Math.min(max, preferred))
  return Math.abs(min - preferred) <= Math.abs(max - preferred) ? min : max
}

/** Смещает origin при полном zoom, чтобы карта целиком влезала в контейнер библиотеки */
export function computeZoomOrigin(el, scale) {
  const r = el.getBoundingClientRect()
  const bounds = getZoomBounds(el)
  if (!bounds || scale <= 1) return '50% 50%'

  const W = r.width
  const H = r.height
  const denomX = W * (1 - scale)
  const denomY = H * (1 - scale)

  let ox = 0.5
  let oy = 0.5

  if (denomX !== 0) {
    const oxMin = (bounds.right - r.left - W * scale) / denomX
    const oxMax = (bounds.left - r.left) / denomX
    ox = Math.max(0, Math.min(1, clampOrigin(oxMin, oxMax, 0.5)))
  }

  if (denomY !== 0) {
    const oyMin = (bounds.bottom - r.top - H * scale) / denomY
    const oyMax = (bounds.top - r.top) / denomY
    oy = Math.max(0, Math.min(1, clampOrigin(oyMin, oyMax, 0.5)))
  }

  return `${ox * 100}% ${oy * 100}%`
}
