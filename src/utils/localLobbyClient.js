import { getGameWsBaseUrl } from './gameWebSocket'
import { getLocalTestDeckPayload } from '../fixtures/testDeck'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function makeLocalLobbyCode() {
  const values = new Uint32Array(6)
  crypto.getRandomValues(values)
  return [...values].map((value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join('')
}

async function request(path, init = {}) {
  const base = getGameWsBaseUrl().replace(/\/$/, '')
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error || `Worker returned ${response.status}`)
  return body
}

export function createLocalLobby(guestId, nickname, deck = getLocalTestDeckPayload()) {
  return request('/lobby', {
    method: 'POST',
    body: JSON.stringify({ code: makeLocalLobbyCode(), hostId: guestId, nickname, deck }),
  })
}

export function joinLocalLobby(id, guestId, nickname, deck = getLocalTestDeckPayload()) {
  return request(`/lobby/${encodeURIComponent(id)}/join`, {
    method: 'POST',
    body: JSON.stringify({ playerId: guestId, nickname, deck }),
  })
}

export function getLocalLobby(id) {
  return request(`/lobby/${encodeURIComponent(id)}`, { method: 'GET' })
}
