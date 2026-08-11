import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../utils/supabase'
import { logError, toUserFacingError } from '../utils/errorLogger'

function applyCardsResponse(data, error, setCards, setError, setLoading) {
  if (error) {
    logError(error, { hook: 'useCards', action: 'loadCards' })
    setError(toUserFacingError(error))
    setCards([])
  } else {
    setCards(data || [])
    setError(null)
  }
  setLoading(false)
}

export function useCards() {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchCards = useCallback(
    () => supabase.from('cards').select('*').order('card_number'),
    [],
  )

  const loadCards = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: fetchError } = await fetchCards()
      applyCardsResponse(data, fetchError, setCards, setError, setLoading)
    } catch (err) {
      applyCardsResponse(null, err, setCards, setError, setLoading)
    }
  }, [fetchCards])

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
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const { data, error: fetchError } = await fetchCards()
        if (cancelled) return
        applyCardsResponse(data, fetchError, setCards, setError, setLoading)
      } catch (err) {
        if (cancelled) return
        applyCardsResponse(null, err, setCards, setError, setLoading)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [fetchCards])

  return { cards, loading, error, loadCards, createCard, updateCard, deleteCard, findSimilarCards }
}
