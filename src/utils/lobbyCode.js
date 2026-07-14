const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // без O, 0, I, 1 — легко читать

export function generateLobbyCode() {
  return Array.from({ length: 6 }, () =>
    CHARS[Math.floor(Math.random() * CHARS.length)]
  ).join('')
}
