import { useCallback } from 'react'
import { supabase } from '../utils/supabase'
import { useSupabaseTable } from './useSupabaseTable'

export function useCards() {
  const { rows: cards, setRows: setCards, loading, error, reload: loadCards } = useSupabaseTable(
    'cards',
    { orderBy: 'card_number', hookName: 'useCards' }
  )

  const createCard = useCallback(async (cardData) => {
    const { data, error: insertError } = await supabase
      .from('cards')
      .insert([{ ...cardData, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }])
      .select()
      .single()
    if (insertError) return { success: false, error: insertError.message }
    if (data) setCards((prev) => [...prev, data])
    return { success: true, data }
  }, [setCards])

  const updateCard = useCallback(async (cardId, cardData) => {
    const { data, error: updateError } = await supabase
      .from('cards')
      .update({ ...cardData, updated_at: new Date().toISOString() })
      .eq('id', cardId)
      .select()
      .single()
    if (updateError) return { success: false, error: updateError.message }
    if (data) setCards((prev) => prev.map((c) => (c.id === cardId ? data : c)))
    return { success: true, data }
  }, [setCards])

  const deleteCard = useCallback(async (cardId) => {
    const { error: deleteError } = await supabase.from('cards').delete().eq('id', cardId)
    if (deleteError) return { success: false, error: deleteError.message }
    setCards((prev) => prev.filter((c) => c.id !== cardId))
    return { success: true }
  }, [setCards])

  const findSimilarCards = useCallback(async (name, description) => {
    const { data, error: rpcError } = await supabase.rpc('find_similar_cards', {
      p_name: name,
      p_description: description || '',
    })
    if (rpcError) {
      console.error('Ошибка поиска похожих карт:', rpcError)
      return []
    }
    return data || []
  }, [])

  return { cards, loading, error, loadCards, createCard, updateCard, deleteCard, findSimilarCards }
}
