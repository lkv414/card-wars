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

  // Оптимизация: insert/update уже возвращают объект через .select() — не делаем
  // второй loadCards(). Просто добавляем/заменяем в локальный state.
  const createCard = useCallback(async (cardData) => {
    const { data, error } = await supabase
      .from('cards')
      .insert([{ ...cardData, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }])
      .select()
      .single()
    if (error) return { success: false, error: error.message }
    if (data) setCards((prev) => [...prev, data])
    return { success: true, data }
  }, [])

  const updateCard = useCallback(async (cardId, cardData) => {
    const { data, error } = await supabase
      .from('cards')
      .update({ ...cardData, updated_at: new Date().toISOString() })
      .eq('id', cardId)
      .select()
      .single()
    if (error) return { success: false, error: error.message }
    if (data) setCards((prev) => prev.map((c) => (c.id === cardId ? data : c)))
    return { success: true, data }
  }, [])

  const deleteCard = useCallback(async (cardId) => {
    const { error } = await supabase.from('cards').delete().eq('id', cardId)
    if (error) return { success: false, error: error.message }
    setCards((prev) => prev.filter((c) => c.id !== cardId))
    return { success: true }
  }, [])

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

  useEffect(() => {
    void Promise.resolve().then(loadCards)
  }, [loadCards])

  return { cards, loading, error, loadCards, createCard, updateCard, deleteCard, findSimilarCards }
}
