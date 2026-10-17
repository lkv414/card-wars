/**
 * useHeroes — список героев из локального JSON (`src/data/heroes.js`).
 *
 * Этап 5 плана v2: раньше тянул `heroes_v` и `deck_heroes_v` из Supabase.
 * Связи «пресет-колода → герои» больше не нужны: пресеты убраны из проекта.
 *
 * Возвращает `{ heroes, loading, error, reload }` — API сохранён, чтобы
 * потребители (DeckList, DeckBuilder, LobbyScreen) не менялись.
 */
import { useCallback, useMemo } from 'react'
import { HEROES } from '../data/heroes.js'

export function useHeroes() {
  const reload = useCallback(() => HEROES, [])

  return useMemo(
    () => ({ heroes: HEROES, loading: false, error: null, reload }),
    [reload],
  )
}
