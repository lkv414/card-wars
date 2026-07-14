const KEY = 'guestId'

export function getGuestId() {
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(KEY, id)
  }
  return id
}

export function getGuestNickname() {
  return localStorage.getItem('guestNickname') ?? ''
}

export function setGuestNickname(name) {
  localStorage.setItem('guestNickname', name.trim())
}
