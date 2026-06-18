import { useState, useCallback } from 'react'

import { supabase } from '../utils/supabase'


export function useDecks() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const generateDeckCode = useCallback(() => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let code = 'DK-'
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
    return code
  }, [])

  const saveDeck = useCallback(async (userId, deckData) => {
    setLoading(true)
    setError(null)
    const code = deckData.code || generateDeckCode()
    const payload = {
      user_id: userId,
      name: deckData.name || 'Моя колода',
      code,
      cards: deckData.cards || [],
      lands: deckData.lands || [],
      updated_at: new Date().toISOString()
    }

    let result
    if (deckData.id) {
      const { data, error } = await supabase.from('decks').update(payload).eq('id', deckData.id).select().single()
      result = { data, error }
    } else {
      payload.created_at = new Date().toISOString()
      const { data, error } = await supabase.from('decks').insert([payload]).select().single()
      result = { data, error }
    }

    setLoading(false)
    if (result.error) {
      setError(result.error.message)
      return { success: false, error: result.error.message }
    }
    return { success: true, data: result.data }
  }, [generateDeckCode])

  const loadDeckByCode = useCallback(async (code) => {
    setLoading(true)
    const { data, error } = await supabase.from('decks').select('*').eq('code', code.toUpperCase().trim()).single()
    setLoading(false)
    if (error) return null
    return data
  }, [])

  const loadDeckById = useCallback(async (deckId) => {
    setLoading(true)
    const { data, error } = await supabase.from('decks').select('*').eq('id', deckId).single()
    setLoading(false)
    if (error) return null
    return data
  }, [])

  const getUserDecks = useCallback(async (userId) => {
    setLoading(true)
    const { data, error } = await supabase.from('decks').select('*').eq('user_id', userId).order('updated_at', { ascending: false })
    setLoading(false)
    if (error) return []
    return data || []
  }, [])

  const deleteDeck = useCallback(async (deckId) => {
    setLoading(true)
    const { error } = await supabase.from('decks').delete().eq('id', deckId)
    setLoading(false)
    if (error) return { success: false, error: error.message }
    return { success: true }
  }, [])

  return { loading, error, generateDeckCode, saveDeck, loadDeckByCode, loadDeckById, getUserDecks, deleteDeck }
}
