/**
 * useHeroes — загружает всех героев из таблицы public."Heroes" + их связи с пресет-колодами.
 *
 * Возвращает:
 *   - heroes: список всех героев
 *   - deckHeroesMap: Map<preset_deck_id, Hero[]>
 *   - loading, error
 */

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../utils/supabase'

export function useHeroes() {
  const [heroes, setHeroes] = useState([])
  const [deckHeroesMap, setDeckHeroesMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadHeroes = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [heroesRes, linksRes] = await Promise.all([
        supabase
          .from('heroes_v')
          .select('id, number, name, description, image_url, mechanics, script, hero_slug')
          .order('number'),
        supabase
          .from('deck_heroes_v')
          .select('preset_deck_id, hero_number, is_primary, sort_order, id, number, name, description, image_url, mechanics, script, hero_slug'),
      ])

      if (heroesRes.error) throw heroesRes.error
      setHeroes(heroesRes.data || [])

      if (linksRes.error) {
        console.warn('[useHeroes] deck_heroes load warn:', linksRes.error.message)
        setDeckHeroesMap({})
      } else {
        const map = {}
        for (const row of linksRes.data || []) {
          const deckId = row.preset_deck_id
          if (!deckId) continue
          if (!map[deckId]) map[deckId] = []
          map[deckId].push({
            id: row.id,
            number: row.number,
            name: row.name,
            description: row.description,
            image_url: row.image_url,
            mechanics: row.mechanics,
            script: row.script,
            hero_slug: row.hero_slug,
            is_primary: row.is_primary,
            sort_order: row.sort_order,
          })
        }
        for (const k of Object.keys(map)) {
          map[k].sort((a, b) => {
            if (a.is_primary && !b.is_primary) return -1
            if (!a.is_primary && b.is_primary) return 1
            return (a.sort_order ?? 0) - (b.sort_order ?? 0)
          })
        }
        setDeckHeroesMap(map)
      }
    } catch (e) {
      console.error('[useHeroes] load failed:', e)
      setError(e?.message || 'Не удалось загрузить героев')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(loadHeroes)
  }, [loadHeroes])

  /** Получить список героев для конкретной колоды */
  const getHeroesForDeck = useCallback(
    (deckId) => (deckId ? (deckHeroesMap[deckId] || []) : []),
    [deckHeroesMap],
  )

  return { heroes, deckHeroesMap, getHeroesForDeck, loading, error, reload: loadHeroes }
}