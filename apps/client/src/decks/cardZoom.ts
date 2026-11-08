const EDGE_PAD = 6;

export const CATALOG_ZOOM_SCALE = 2.65;
export const DECK_ZOOM_SCALE = 3.2;

function clampOrigin(min: number, max: number, preferred = 0.5): number {
  if (min <= max) return Math.max(min, Math.min(max, preferred));
  return Math.abs(min - preferred) <= Math.abs(max - preferred) ? min : max;
}

function getZoomBounds(el: HTMLElement): { left: number; right: number; top: number; bottom: number } {
  const container = el.closest<HTMLElement>('[data-zoom-bounds]');
  if (container) {
    const rect = container.getBoundingClientRect();
    return {
      left: rect.left + EDGE_PAD,
      right: Math.min(window.innerWidth - EDGE_PAD, rect.right - EDGE_PAD),
      top: Math.max(EDGE_PAD, rect.top + EDGE_PAD),
      bottom: Math.min(window.innerHeight - EDGE_PAD, rect.bottom - EDGE_PAD),
    };
  }
  return {
    left: EDGE_PAD,
    right: window.innerWidth - EDGE_PAD,
    top: EDGE_PAD,
    bottom: window.innerHeight - EDGE_PAD,
  };
}

/** Shifts transform-origin near container/viewport edges so the zoomed card is never clipped. */
export function computeZoomOrigin(el: HTMLElement, scale: number): string {
  if (scale <= 1) return '50% 50%';
  const r = el.getBoundingClientRect();
  const bounds = getZoomBounds(el);

  const W = r.width;
  const H = r.height;
  const denomX = W * (1 - scale);
  const denomY = H * (1 - scale);

  let ox = 0.5;
  let oy = 0.5;

  if (denomX !== 0) {
    const oxMin = (bounds.right - r.left - W * scale) / denomX;
    const oxMax = (bounds.left - r.left) / denomX;
    ox = Math.max(0, Math.min(1, clampOrigin(oxMin, oxMax, 0.5)));
  }

  if (denomY !== 0) {
    const oyMin = (bounds.bottom - r.top - H * scale) / denomY;
    const oyMax = (bounds.top - r.top) / denomY;
    oy = Math.max(0, Math.min(1, clampOrigin(oyMin, oyMax, 0.5)));
  }

  return `${(ox * 100).toFixed(1)}% ${(oy * 100).toFixed(1)}%`;
}
