/**
 * Game Multiplayer Constants
 * Правила для игры 2-4 игроков по правилам Card Wars
 */

/**
 * Максимальное количество игроков в игре
 */
export const MAX_PLAYERS = 4

/**
 * Количество зон (земель) у каждого игрока
 */
export const ZONES_PER_PLAYER = 4

/**
 * Структура противостояния зон:
 * Для 2 игроков: все 4 земли каждого против всех 4 земель противника
 * Для 3-4 игроков:
 *   - Левые 2 земли (0, 1) против правых 2 земель (2, 3) соседа справа
 *   - Правые 2 земли (2, 3) против левых 2 земель (0, 1) соседа слева
 */
export const ZONE_OPPOSITION = {
  // Для 2 игроков: player 0 vs player 1
  2: {
    0: { opponentIndex: 1, opponentZones: [0, 1, 2, 3] },
    1: { opponentIndex: 0, opponentZones: [0, 1, 2, 3] },
  },
  // Для 3 игроков: player 0 vs 1, 1 vs 2, 2 vs 0
  3: {
    0: { opponentIndex: 1, opponentZones: [2, 3] }, // левые земли 0,1 vs правые земли 1 (2,3)
    1: { opponentIndex: 2, opponentZones: [2, 3] }, // левые земли 0,1 vs правые земли 2 (2,3)
    2: { opponentIndex: 0, opponentZones: [2, 3] }, // левые земли 2,3 vs правые земли 0 (2,3)
  },
  // Для 4 игроков: player 0 vs 1, 1 vs 2, 2 vs 3, 3 vs 0
  4: {
    0: { opponentIndex: 1, opponentZones: [2, 3] }, // левые земли 0,1 vs правые земли 1 (2,3)
    1: { opponentIndex: 2, opponentZones: [2, 3] }, // левые земли 0,1 vs правые земли 2 (2,3)
    2: { opponentIndex: 3, opponentZones: [2, 3] }, // левые земли 2,3 vs правые земли 3 (2,3)
    3: { opponentIndex: 0, opponentZones: [2, 3] }, // левые земли 2,3 vs правые земли 0 (2,3)
  },
}

/**
 * Типы карт с их характеристиками
 */
export const CARD_TYPE_CHARACTERISTICS = {
  creature: {
    hasAttack: true,
    hasDefense: true,
    canFlip: true,
    canAttack: true,
    requiresLands: true,
  },
  building: {
    hasAttack: false,
    hasDefense: true,
    canFlip: true,
    canAttack: false,
    requiresLands: true,
  },
  spell: {
    hasAttack: false,
    hasDefense: false,
    canFlip: false,
    canAttack: false,
    requiresLands: true,
  },
}

/**
 * Статусы карты на поле
 */
export const CARD_STATUSES = {
  ready: 'ready',       // Готова к действию (в начале хода все карты готовятся)
  tapped: 'tapped',     // Активирована (повёрнута набок) - атаковала или флюпнута
  flipped: 'flipped',   // Флюпнута (использует способность вместо атаки)
  exhausted: 'exhausted', // Исчерпана (не может действовать в этом ходу)
}

/**
 * Фазы хода (по правилам игры)
 */
export const TURN_PHASES = {
  draw: 'draw',         // 1. Возьми карту
  main: 'main',         // 2-5. Реши, на что потратить 2 действия + Флюпнуть или не флюпнуть
  attack: 'attack',     // 6. Нападай!
  end: 'end',           // 7. Закончи ход
}

/**
 * Порядок хода (по правилам)
 */
export const TURN_ORDER = [
  TURN_PHASES.draw,
  TURN_PHASES.main,
  TURN_PHASES.attack,
  TURN_PHASES.end,
]

/**
 * Количество действий за ход
 */
export const ACTIONS_PER_TURN = 2

/**
 * Начальное количество жизней
 */
export const INITIAL_HEALTH = 25

/**
 * Правила для флюпа:
 * - Флюпать можно до траты действий, после траты одного или обоих
 * - Флюпать можно только в свой ход
 * - Флюпать можно в тот же ход, в который карта вошла в игру
 * - Флюпнутое существо НЕ может нападать в этом ходу
 * - Флюпнутое существо МОЖЕТ защищаться
 */
export const FLIP_RULES = {
  canFlipBeforeActions: true,
  canFlipAfterActions: true,
  canFlipInOpponentTurn: false,
  canFlipNewCards: true,
  flippedCanAttack: false,
  flippedCanDefend: true,
}
