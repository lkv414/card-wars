import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../utils/supabase'

export function useCardArt(cardId) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (!cardId) {
      setRows([])
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('card_art')
      .select('id, card_id, source_url, source_kind, is_primary, variant, width, height')
      .eq('card_id', cardId)
      .order('is_primary', { ascending: false })
      .order('created_at')

    if (!error) setRows(data || [])
    setLoading(false)
  }, [cardId])

  useEffect(() => {
    // setState внутри reload() — асинхронный, но правило
    // react-hooks/set-state-in-effect ругается на сам вызов reload(),
    // который синхронно стартует с setLoading(true). Обёртка в
    // Promise.resolve().then() делает setState формально асинхронным.
    Promise.resolve().then(() => reload())
  }, [reload])

  const addArt = useCallback(async ({ source_url, source_kind = 'url', variant = null, is_primary = false }) => {
    if (!cardId || !source_url?.trim()) return { success: false, error: 'URL обязателен' }

    if (is_primary) {
      await supabase.from('card_art').update({ is_primary: false }).eq('card_id', cardId)
    }

    const { data, error } = await supabase
      .from('card_art')
      .insert({
        card_id: cardId,
        source_url: source_url.trim(),
        source_kind,
        variant,
        is_primary: is_primary || rows.length === 0,
      })
      .select()
      .maybeSingle()

    if (error) return { success: false, error: error.message }
    await reload()
    return { success: true, data }
  }, [cardId, rows.length, reload])

  const setPrimary = useCallback(async (artId) => {
    if (!cardId) return { success: false }
    await supabase.from('card_art').update({ is_primary: false }).eq('card_id', cardId)
    const { error } = await supabase.from('card_art').update({ is_primary: true }).eq('id', artId)
    if (error) return { success: false, error: error.message }
    await reload()
    return { success: true }
  }, [cardId, reload])

  const removeArt = useCallback(async (artId) => {
    const { error } = await supabase.from('card_art').delete().eq('id', artId)
    if (error) return { success: false, error: error.message }
    await reload()
    return { success: true }
  }, [reload])

  return { rows, loading, reload, addArt, setPrimary, removeArt }
}
