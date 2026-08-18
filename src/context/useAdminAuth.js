/**
 * useAdminAuth — хук для чтения AdminAuthContext.
 *
 * Вынесен из AdminAuthContext.jsx чтобы соблюсти правило
 * react-refresh/only-export-components (Vite HMR): файлы с React-компонентами
 * не должны экспортировать ничего кроме компонентов.
 */
import { useContext } from 'react'
import { AdminAuthContext } from './AdminAuthContextValue.js'

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext)
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider')
  return ctx
}
