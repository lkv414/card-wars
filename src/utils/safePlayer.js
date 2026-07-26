/**
 * safePlayer.js — защитный слой для game.players.
 *
 * Проблема: при чтении .health / .player_id на undefined-объекте получаем
 * `TypeError: Cannot read properties of undefined (reading 'health')`.
 * `(x.health ?? 0)` НЕ спасает — сначала читается x.health.
 *
 * Этот модуль:
 *  - safePlayer(players, target) — возвращает «безопасного» игрока (никогда undefined).
 *  - DEFAULT_PLAYER — фоллбек со всеми полями.
 *  - safePlayers(players) — нормализует весь массив (filter null/undefined + здоровье).
 *
 * Используй:
 *   const opp = safePlayer(game.players, toPlayerId)   // вместо find()
 *   const arr = safePlayers(game.players)              // вместо map()
 */

export const DEFAULT_PLAYER = Object.freeze({
  player_id: 'unknown',
  nickname: 'Игрок',
  health: 25,
  hand: [],
  deck_pile: [],
  zones: { 0: [], 1: [], 2: [], 3: [] },
})

/**
 * Безопасно достать игрока по индексу или player_id.
 * Никогда не возвращает undefined — в худшем случае DEFAULT_PLAYER.
 * @param {Array} players
 * @param {number|string|null|undefined} target — индекс или player_id
 * @returns {object} всегда валидный объект игрока
 */
export function safePlayer(players, target) {
  // Помощник: построить фоллбек с маркером
  const makeFallback = () => ({
    ...DEFAULT_PLAYER,
    player_id: String(target ?? 'unknown'),
    __isFallback: true,
  })

  if (!Array.isArray(players) || players.length === 0) {
    return makeFallback()
  }

  let found
  if (typeof target === 'number') {
    found = players[target]
  } else if (typeof target === 'string') {
    found = players.find((p) => p && p.player_id === target)
  } else {
    // target === null/undefined: первый живой, если такие есть; иначе фоллбек.
    const alive = players.find((p) => p && (p.health ?? 0) > 0)
    if (alive) {
      found = alive
    } else {
      return makeFallback()
    }
  }

  if (!found) {
    return makeFallback()
  }

  return {
    ...DEFAULT_PLAYER,
    ...found,
    // гарантируем валидный health
    health:
      typeof found.health === 'number' && Number.isFinite(found.health)
        ? found.health
        : DEFAULT_PLAYER.health,
  }
}

/**
 * Нормализует весь массив игроков: фильтрует null/undefined, фиксит health.
 * @param {Array|null|undefined} players
 * @returns {Array} гарантированно массив (может быть пустым)
 */
export function safePlayers(players) {
  if (!Array.isArray(players)) return []
  return players
    .filter(Boolean)
    .map((p) => ({
      ...DEFAULT_PLAYER,
      ...p,
      health:
        typeof p.health === 'number' && Number.isFinite(p.health)
          ? p.health
          : DEFAULT_PLAYER.health,
    }))
}
