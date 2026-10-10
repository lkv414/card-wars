import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * Переход «назад» с учётом источника.
 *
 * Если экран открыт через navigateTo(...) и в state есть `from`, возвращаемся туда.
 * Иначе (прямой заход по ссылке, обновление страницы) уходим на `fallback`.
 */
export function useBackNavigation(fallback = '/') {
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from

  return useCallback(() => {
    if (from && from !== location.pathname) {
      navigate(from)
      return
    }
    navigate(fallback)
  }, [from, fallback, location.pathname, navigate])
}

/**
 * Переход на экран с запоминанием текущего маршрута, чтобы «назад» вернул сюда.
 */
export function useNavigateWithOrigin() {
  const navigate = useNavigate()
  const location = useLocation()

  return useCallback(
    (to, options = {}) => {
      navigate(to, {
        ...options,
        state: { ...(options.state || {}), from: location.pathname + location.search },
      })
    },
    [location.pathname, location.search, navigate],
  )
}
