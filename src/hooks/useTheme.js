/**
 * useTheme — Управление темой приложения
 * 
 * Предоставляет:
 * - Текущая тема (light/dark/system)
 * - Функция для переключения темы
 * - Автоматическое применение темы к document
 */

import { useEffect, useState, useCallback } from 'react'

const THEMES = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system',
}

const STORAGE_KEY = 'theme-preference'

/** Получение сохраненной темы из localStorage */
function getStoredTheme() {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && Object.values(THEMES).includes(stored)) {
    return stored
  }
  return null
}

/** Получение системной темы */
function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? THEMES.DARK
    : THEMES.LIGHT
}

/** Применение темы к document */
function applyTheme(theme) {
  const root = document.documentElement
  
  // Удаляем все классы тем
  root.classList.remove('theme-light', 'theme-dark')
  
  if (theme === THEMES.DARK) {
    root.classList.add('theme-dark')
    root.style.colorScheme = 'dark'
  } else {
    root.classList.add('theme-light')
    root.style.colorScheme = 'light'
  }
  
  // Обновляем CSS-переменные
  const colorScheme = theme === THEMES.DARK ? 'dark' : 'light'
  root.style.setProperty('color-scheme', colorScheme)
}

/** Сохранение темы в localStorage */
function saveTheme(theme) {
  localStorage.setItem(STORAGE_KEY, theme)
}

export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    // Порядок приоритетов:
    // 1. Сохраненная тема в localStorage
    // 2. Системная тема
    const stored = getStoredTheme()
    if (stored) {
      return stored
    }
    return THEMES.SYSTEM
  })

  // Применяем тему при монтировании
  useEffect(() => {
    const effectiveTheme = theme === THEMES.SYSTEM ? getSystemTheme() : theme
    applyTheme(effectiveTheme)
  }, [theme])

  // Следим за изменениями системной темы
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    
    const handleChange = (e) => {
      if (theme === THEMES.SYSTEM) {
        applyTheme(e.matches ? THEMES.DARK : THEMES.LIGHT)
      }
    }
    
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])

  // Установка конкретной темы
  const setTheme = useCallback((newTheme) => {
    if (Object.values(THEMES).includes(newTheme)) {
      setThemeState(newTheme)
      saveTheme(newTheme)
      const effectiveTheme = newTheme === THEMES.SYSTEM ? getSystemTheme() : newTheme
      applyTheme(effectiveTheme)
    }
  }, [])

  // Переключение темы
  const toggleTheme = useCallback(() => {
    const current = getStoredTheme() || getSystemTheme()
    const next = current === THEMES.DARK ? THEMES.LIGHT : THEMES.DARK
    setTheme(next)
  }, [setTheme])

  // Получение эффективной темы (с учетом system)
  const effectiveTheme = theme === THEMES.SYSTEM ? getSystemTheme() : theme

  return {
    theme,
    effectiveTheme,
    toggleTheme,
    setTheme,
    isDark: effectiveTheme === THEMES.DARK,
    isLight: effectiveTheme === THEMES.LIGHT,
  }
}

export { THEMES, getStoredTheme, getSystemTheme, applyTheme }
