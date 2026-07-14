import { useSyncExternalStore } from 'react'

export const ROUTES = {
  menu: '/',
  deck: '/deck',
  admin: '/admin',
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
