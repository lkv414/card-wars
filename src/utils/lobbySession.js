export const LOBBY_STORAGE_KEY = 'activeLobby'
export const LOBBY_MAX_AGE_HOURS = 6

export function saveLobbySession(lobbyId, code, hostId, isHost) {
  localStorage.setItem(
    LOBBY_STORAGE_KEY,
    JSON.stringify({ lobbyId, code, hostId, isHost, savedAt: Date.now() })
  )
}

export function loadLobbySession() {
  try {
    const raw = localStorage.getItem(LOBBY_STORAGE_KEY)
    if (!raw) return null
    const session = JSON.parse(raw)
    const ageHours = (Date.now() - session.savedAt) / 1000 / 3600
    if (ageHours > LOBBY_MAX_AGE_HOURS) {
      localStorage.removeItem(LOBBY_STORAGE_KEY)
      return null
    }
    return session
  } catch {
    return null
  }
}

export function clearLobbySession() {
  localStorage.removeItem(LOBBY_STORAGE_KEY)
}
