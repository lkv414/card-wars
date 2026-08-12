/** Цвета земель — палитра Adventure Time Card Wars. */

export const LAND_BORDER_COLOR = '#e67e22'
export const GRID_NEON_CYAN = '#00e8ff'
export const PLAY_MAT_COLOR = '#4caf50'

export const LAND_TYPE_COLORS = {
  corn: { fill: '#7cb342', emissive: '#558b2f', label: 'Кукурузные поля' },
  ice: { fill: '#81d4fa', emissive: '#0288d1', label: 'Ледяная' },
  good: { fill: '#f48fb1', emissive: '#c2185b', label: 'Хорошие земли' },
  swamp: { fill: '#546e7a', emissive: '#37474f', label: 'Бесполезное болото' },
  sand: { fill: '#ffcc80', emissive: '#ef6c00', label: 'Пустынная' },
  blue: { fill: '#42a5f5', emissive: '#1565c0', label: 'Синие равнины' },
  any: { fill: '#ce93d8', emissive: '#7b1fa2', label: 'Радужная' },
}

/** CSS-бордер карт в руке по типу земли */
export const LAND_CARD_BORDER = {
  corn: '#7cb342',
  ice: '#29b6f6',
  good: '#f06292',
  swamp: '#78909c',
  sand: '#ffb74d',
  blue: '#42a5f5',
  any: '#ba68c8',
}

export const CREATURE_SLOT_COLOR = '#e53935'
export const BUILDING_SLOT_COLOR = '#43a047'
export const DEFAULT_LAND_FILL = '#5d4e37'

export function getLandPalette(landType) {
  return LAND_TYPE_COLORS[landType] || {
    fill: DEFAULT_LAND_FILL,
    emissive: '#3e3226',
    label: 'Земля',
  }
}

export function getLandCardBorder(landType) {
  return LAND_CARD_BORDER[landType] || '#78909c'
}
