import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../utils/supabase'

export function useCards() {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadCards = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase.from('cards').select('*').order('card_number')
    if (error) {
      console.error('Ошибка загрузки карт:', error)
      setError(error.message)
      setCards([])
    } else {
      setCards(data || [])
    }
    setLoading(false)
  }, [])

  const createCard = useCallback(async (cardData) => {
    const { data, error } = await supabase
      .from('cards')
      .insert([{ ...cardData, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }])
      .select()
      .single()
    if (error) return { success: false, error: error.message }
    await loadCards()
    return { success: true, data }
  }, [loadCards])

  const updateCard = useCallback(async (cardId, cardData) => {
    const { data, error } = await supabase
      .from('cards')
      .update({ ...cardData, updated_at: new Date().toISOString() })
      .eq('id', cardId)
      .select()
      .single()
    if (error) return { success: false, error: error.message }
    await loadCards()
    return { success: true, data }
  }, [loadCards])

  const deleteCard = useCallback(async (cardId) => {
    const { error } = await supabase.from('cards').delete().eq('id', cardId)
    if (error) return { success: false, error: error.message }
    await loadCards()
    return { success: true }
  }, [loadCards])

  const findSimilarCards = useCallback(async (name, description) => {
    const { data, error } = await supabase.rpc('find_similar_cards', {
      p_name: name,
      p_description: description || ''
    })
    if (error) {
      console.error('Ошибка поиска похожих карт:', error)
      return []
    }
    return data || []
  }, [])

  // Клиентская фильтрация (удобно для UI)
  const filterCards = useCallback((filters = {}) => {
    let result = [...cards]
    if (filters.search) {
      const q = filters.search.toLowerCase()
      result = result.filter(c => c.name.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q))
    }
    if (filters.type && filters.type !== 'all') result = result.filter(c => c.card_type === filters.type)
    if (filters.landType && filters.landType !== 'all') result = result.filter(c => c.land_type === filters.landType)
    if (filters.isRainbow !== undefined) result = result.filter(c => c.is_rainbow === filters.isRainbow)
    if (filters.hasFlip !== undefined) result = result.filter(c => c.has_flip === filters.hasFlip)
    return result
  }, [cards])

  useEffect(() => {
    void Promise.resolve().then(loadCards)
  }, [loadCards])

  return { cards, loading, error, loadCards, createCard, updateCard, deleteCard, findSimilarCards, filterCards }
}
