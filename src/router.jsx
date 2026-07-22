import { useSyncExternalStore } from 'react'

export const ROUTES = {
  menu: '/',
  deck: '/deck',
  admin: '/admin',
  lobby: '/lobby',
  lobbyRoom: '/lobby/:code',
}

function subscribe(onStoreChange) {
  window.addEventListener('popstate', onStoreChange)
  return () => window.removeEventListener('popstate', onStoreChange)
}

function getPathname() {
  return window.location.pathname
}

/** Текущий pathname; обновляется при pushState / назад-вперёд */
export function usePathname() {
  return useSyncExternalStore(subscribe, getPathname, () => '/')
}

export function navigate(to, { replace = false } = {}) {
  const method = replace ? 'replaceState' : 'pushState'
  if (window.location.pathname === to) return
  window.history[method](null, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/**
 * Сопоставляет pathname с паттерном (например '/lobby/:code').
 * Возвращает объект параметров или null если не совпало.
 */
export function matchPath(pattern, pathname) {
  const patternParts = pattern.split('/')
  const pathParts = pathname.split('/')
  if (patternParts.length !== pathParts.length) return null

  const params = {}
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i])
    } else if (patternParts[i] !== pathParts[i]) {
      return null
    }
  }
  return params
}
