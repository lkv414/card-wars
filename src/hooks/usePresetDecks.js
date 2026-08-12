import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../utils/supabase'

export function usePresetDecks() {
  const [presets, setPresets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: fetchErr } = await supabase
      .from('preset_decks')
      .select(`
        id, slug, name, hero_slug, mode, description, sort_order,
        preset_deck_cards ( slot, is_landscape, card_id, cards ( id, card_number, name, cost, card_type, land_type ) )
      `)
      .eq('is_active', true)
      .order('sort_order')

    if (fetchErr) {
      setError(fetchErr.message)
      setPresets([])
    } else {
      setPresets(data || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { presets, loading, error, reload: load }
}

/** Convert preset row to deck builder selection maps. */
export function presetToDeckSelection(preset) {
  const selectedCards = {}
  const selectedLands = {}
  for (const row of preset.preset_deck_cards || []) {
    const id = row.card_id
    if (!id) continue
    if (row.is_landscape) {
      selectedLands[id] = (selectedLands[id] || 0) + 1
    } else {
      selectedCards[id] = (selectedCards[id] || 0) + 1
    }
  }
  return { selectedCards, selectedLands, name: preset.name }
}
