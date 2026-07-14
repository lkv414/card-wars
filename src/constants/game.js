export const CARD_TYPES = {
  creature: 'Существо',
  building: 'Строение',
  spell: 'Заклинание',
}

export const LAND_TYPES = {
  corn: { label: 'Кукурузное поле', icon: '🌽' },
  ice: { label: 'Ледяная', icon: '❄️' },
  desert: { label: 'Пустынная', icon: '🏜️' },
  good: { label: 'Добрая', icon: '🌸' },
  swamp: { label: 'Бесполезное болото', icon: '🌿' },
  sand: { label: 'Песчаная', icon: '🏖️' },
  blue: { label: 'Синяя равнина', icon: '🔵' },
  any: { label: 'Любой', icon: '🌈' },
}

export const DECK_LIMITS = {
  cards: { maxPerEntry: 3, maxTotal: 40 },
  lands: { maxPerEntry: 4, maxTotal: 4 },
}

