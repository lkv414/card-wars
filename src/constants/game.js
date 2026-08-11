export const CARD_TYPES = {
  creature: 'Существо',
  building: 'Строение',
  spell: 'Заклинание',
}

export const LAND_TYPES = {
  corn: { shortLabel: 'Кукуруза', label: 'Кукурузное поле', icon: '🌽' },
  ice: { shortLabel: 'Ледяная', label: 'Ледяная земля', icon: '❄️' },
  good: { shortLabel: 'Добрая', label: 'Добрая земля', icon: '🌸' },
  swamp: { shortLabel: 'Болото', label: 'Бесполезное болото', icon: '🌿' },
  sand: { shortLabel: 'Пустынная', label: 'Пустынная земля', icon: '🏜️' },
  blue: { shortLabel: 'Синяя', label: 'Синяя равнина', icon: '🔵' },
  any: { shortLabel: 'Радужные', label: 'Любая земля', icon: '🌈' },
}

export const DECK_LIMITS = {
  cards: { maxPerEntry: 3, maxTotal: 40 },
  lands: { maxPerEntry: 4, maxTotal: 4 },
}

/** Сколько карт в руке при старте игры */
export const STARTING_HAND_SIZE = 5

