/**
 * E2E-сценарий для Этапа 6 (v2): лобби → старт против бота → WS-партия.
 *
 * Проверяет то, что не покрывается unit-тестами:
 *   - LobbyRoom добавляет место бота и собирает localGameState;
 *   - GameRoom принимает join по membership из LobbyRoom (без Supabase);
 *   - бот получает колоду из cards.json (hand_count 5 / deck_pile_count 15);
 *   - GET /game/:id/state отдаёт снимок своему и 403 чужому;
 *   - alarm ведёт ход бота и возвращает ход человеку.
 *
 * Запуск: npm run workers:dev в одном терминале, npm run e2e:bot — в другом.
 * Участвует в ручной проверке этапа, в гейт (npm test) не входит: нужен живой Worker.
 */
import cardsJson from '../individual_cards/cards.json' with { type: 'json' }

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8787'
const WS_BASE = BASE.replace(/^http/, 'ws')
const HOST = `e2e-host-${Math.random().toString(16).slice(2, 8)}`
const CODE = `E2E${Math.random().toString(16).slice(2, 6).toUpperCase()}`

const log = (...args) => console.log('[e2e]', ...args)
const fail = (msg) => {
  console.error('[e2e] FAIL:', msg)
  process.exitCode = 1
  throw new Error(msg)
}

function buildDeck(cards) {
  return {
    name: 'E2E deck',
    cardCount: cards.length,
    cards: cards.map((card, index) => ({ ...card, instanceId: `${card.id}-${index}` })),
    lands: [1, 2, 3, 4].map((position) => ({
      id: 'corn',
      land_id: 'corn',
      land_type: 'corn',
      zone_position: position,
    })),
  }
}

async function post(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`${path} → ${response.status} ${JSON.stringify(payload)}`)
  return payload
}

function openSocket(url, protocol) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, protocol)
    ws.addEventListener('open', () => resolve(ws))
    ws.addEventListener('error', (event) => reject(new Error(`WS error: ${event?.message || url}`)))
  })
}

/** Wait for the first message matching `predicate`, with a timeout. */
function waitFor(ws, predicate, { timeoutMs = 15_000, label = 'message' } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage)
      reject(new Error(`timeout waiting for ${label}`))
    }, timeoutMs)
    function onMessage(event) {
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }
      if (!predicate(msg)) return
      clearTimeout(timer)
      ws.removeEventListener('message', onMessage)
      resolve(msg)
    }
    ws.addEventListener('message', onMessage)
  })
}

/** Collect states until `stop(state)` says the observed turn is over. */
function collectStates(ws, stop, { timeoutMs = 25_000 } = {}) {
  return new Promise((resolve) => {
    const states = []
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage)
      resolve(states)
    }, timeoutMs)
    function onMessage(event) {
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }
      if (msg.type !== 'state' && msg.type !== 'state_with_battle') return
      states.push(msg.game)
      if (stop(msg.game)) {
        clearTimeout(timer)
        ws.removeEventListener('message', onMessage)
        resolve(states)
      }
    }
    ws.addEventListener('message', onMessage)
  })
}

const playable = cardsJson.filter(
  (card) => card.card_type === 'creature' || card.card_type === 'building',
)

const main = async () => {
  // 0. Worker жив?
  const health = await fetch(`${BASE}/health`).then((r) => r.json())
  log('health', health)
  await checkLobbyBotFlow()
  await checkDevRoom()
  log('OK — все проверки пройдены')
  process.exit(0)
}

/**
 * Dev-комната (`local-*` из offline-режима): без лобби, с x-dev-bypass.
 * Проверяем, что ensureDevGame собрал обе колоды из каталога и бот играет.
 */
async function checkDevRoom() {
  const roomId = `local-e2e-${Math.random().toString(16).slice(2, 6)}`
  const clientId = `dev-human-${Math.random().toString(16).slice(2, 6)}`
  const ws = await openSocket(`${WS_BASE}/game/${roomId}/ws`, 'x-dev-bypass')
  const first = await (async () => {
    const pending = waitFor(ws, (m) => m.type === 'state', { label: 'dev room state' })
    ws.send(JSON.stringify({ type: 'join', clientId, requestId: 'd1' }))
    return pending
  })()

  const game = first.game
  const me = game.players.find((p) => p.player_id === clientId)
  const bot = game.players.find((p) => p.is_bot === true)
  if (!me || !bot) fail('dev-комната: нет человека или бота')
  if (me.hand_count !== 5 || me.deck_pile_count !== 15) {
    fail(`dev-комната: у человека нет колоды из каталога (${me.hand_count}+${me.deck_pile_count})`)
  }
  if (bot.hand_count !== 5) fail(`dev-комната: у бота нет колоды (${bot.hand_count})`)
  log('dev room ok:', {
    players: game.players.length,
    human: `${me.hand_count}+${me.deck_pile_count}`,
    bot: `${bot.hand_count}+${bot.deck_pile_count}`,
    botLand: bot.zones[0]?.land_type,
    current: game.current_player_id === clientId ? 'human' : 'bot',
  })

  const botZonesBefore = bot.zones.reduce((sum, z) => sum + z.cards.length, 0)
  const observed = collectStates(ws, (state) => {
    if (state.current_player_id === bot.player_id) return false
    const seen = state.players.find((p) => p.player_id === bot.player_id)
    return seen.zones.reduce((sum, z) => sum + z.cards.length, 0) > botZonesBefore
  })
  ws.send(JSON.stringify({ type: 'action', action: 'end_turn', payload: {}, requestId: 'd2' }))
  const states = await observed
  const last = states.at(-1)
  const botZonesAfter = last
    ? last.players.find((p) => p.player_id === bot.player_id).zones.reduce((s, z) => s + z.cards.length, 0)
    : botZonesBefore
  log('dev room bot turn:', {
    states: states.length,
    zones: `${botZonesBefore} → ${botZonesAfter}`,
    backToHuman: last?.current_player_id === clientId,
  })
  if (states.length === 0) fail('dev-комната: бот не сходил')
  if (botZonesAfter <= botZonesBefore) fail('dev-комната: бот не разыграл карту')
  ws.close()
}

const checkLobbyBotFlow = async () => {
  // 0. Worker жив?
  const health = await fetch(`${BASE}/health`).then((r) => r.json())
  log('health', health)

  // 1. Лобби
  const lobby = await post('/lobby', {
    code: CODE,
    hostId: HOST,
    nickname: 'E2E Host',
    deck: buildDeck(playable.slice(0, 20)),
  })
  log('lobby created', lobby.id, 'players:', lobby.lobby_players?.length)

  const lobbyWs = await openSocket(`${WS_BASE}/lobby/${CODE}/ws`)
  lobbyWs.send(JSON.stringify({ type: 'join', clientId: HOST, requestId: 'j1' }))
  await waitFor(lobbyWs, (m) => m.type === 'joined', { label: 'lobby joined' })
  log('lobby ws joined')

  // 2. Старт против бота
  const started = waitFor(lobbyWs, (m) => m.type === 'lobby' && m.lobby?.status === 'in_game', {
    label: 'start_game',
    timeoutMs: 10_000,
  })
  lobbyWs.send(
    JSON.stringify({
      type: 'action',
      action: 'start_game',
      payload: { landPlacementRule: 'strict', vsBot: true },
      requestId: 'a1',
    }),
  )
  const startedMsg = await started
  const roster = startedMsg.lobby.lobby_players
  log('started, roster:', roster.map((p) => `${p.nickname}${p.is_bot ? '(bot)' : ''}`).join(', '))
  if (!roster.some((p) => p.is_bot === true)) fail('бот не добавлен в состав лобби')
  const botId = roster.find((p) => p.is_bot === true).player_id
  lobbyWs.close()

  // 3. Партия: join → state
  const gameWs = await openSocket(`${WS_BASE}/game/${CODE}/ws`)
  const stateMsg = waitFor(gameWs, (m) => m.type === 'state', { label: 'first state' })
  gameWs.send(JSON.stringify({ type: 'join', clientId: HOST, requestId: 'g1' }))
  const first = await stateMsg
  const game = first.game
  const me = game.players.find((p) => p.player_id === HOST)
  const bot = game.players.find((p) => p.player_id === botId)
  if (!me || !bot) fail('в состоянии нет игрока или бота')
  if (bot.hand_count !== 5 || bot.deck_pile_count !== 15) {
    fail(`у бота нет колоды из каталога: hand=${bot.hand_count} deck=${bot.deck_pile_count}`)
  }
  if (me.hand_count !== 5) fail(`у человека не 5 карт: ${me.hand_count}`)
  log('state ok:', {
    status: game.status,
    version: game.version,
    current: game.current_player_id === HOST ? 'host' : 'bot',
    botCards: `${bot.hand_count}+${bot.deck_pile_count}`,
    botZones: bot.zones.map((z) => z.cards.length).join('/'),
    botLand: bot.zones[0]?.land_type,
  })
  if (game.current_player_id !== HOST) fail('первым должен ходить человек')
  if (bot.zones[0]?.land_type !== 'corn') fail(`земля бота: ${bot.zones[0]?.land_type}`)

  // 4. HTTP-маршрут состояния
  const httpState = await fetch(`${BASE}/game/${CODE}/state?playerId=${HOST}`)
  const httpBody = await httpState.json()
  log('GET /state →', httpState.status, 'players:', httpBody.players?.length)
  if (httpState.status !== 200) fail(`GET /state вернул ${httpState.status}`)
  const foreign = await fetch(`${BASE}/game/${CODE}/state?playerId=stranger-${Date.now()}`)
  log('GET /state (чужой) →', foreign.status)
  if (foreign.status !== 403) fail(`чужой получил ${foreign.status}, ожидалось 403`)

  // 5. Ход бота: end_turn → наблюдаем
  const botZonesBefore = bot.zones.reduce((sum, z) => sum + z.cards.length, 0)
  const observed = collectStates(gameWs, (state) => {
    if (state.current_player_id !== botId) return false
    const seenBot = state.players.find((p) => p.player_id === botId)
    const cards = seenBot.zones.reduce((sum, z) => sum + z.cards.length, 0)
    // Ход бота завершён, когда он снова передал ход человеку.
    return cards > 0 && state.current_player_id === HOST
  })
  gameWs.send(JSON.stringify({ type: 'action', action: 'end_turn', payload: {}, requestId: 'e1' }))

  const states = await observed
  const seq = states.map((s) => `${s.version}:${s.current_player_id === HOST ? 'host' : 'bot'}`)
  const botZonesAfter = (() => {
    const last = states.at(-1)
    const seen = last.players.find((p) => p.player_id === botId)
    return seen.zones.reduce((sum, z) => sum + z.cards.length, 0)
  })()
  log('versions:', seq.join(' → '))
  log('bot zones:', botZonesBefore, '→', botZonesAfter)
  if (states.length === 0) fail('после end_turn не пришло ни одного состояния')
  if (!seq.some((s) => s.endsWith(':bot'))) fail('ход не дошёл до бота')
  if (states.at(-1).current_player_id !== HOST) fail('бот не вернул ход человеку')
  if (botZonesAfter <= botZonesBefore) fail('бот не разыграл ни одной карты')
  const botActions = states.map((s) => s.players.find((p) => p.player_id === botId).actions_remaining)
  log('bot actions_remaining:', botActions.join(' → '))

  gameWs.close()
}

main().catch((err) => {
  console.error('[e2e] ошибка:', err?.message || err)
  process.exit(1)
})
