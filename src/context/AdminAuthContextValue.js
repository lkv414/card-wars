/**
 * AdminAuthContext — React context для админ-аутентификации.
 *
 * Вынесен из AdminAuthContext.jsx (где живёт AdminAuthProvider — компонент),
 * чтобы соблюсти правило react-refresh/only-export-components (Vite HMR):
 * файлы с React-компонентами не должны экспортировать ничего кроме компонентов.
 */
import { createContext } from 'react'

export const AdminAuthContext = createContext(null)
