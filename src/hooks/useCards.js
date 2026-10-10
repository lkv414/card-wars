import { useCallback } from 'react'
import { supabase } from '../utils/supabase'
import { useSupabaseTable } from './useSupabaseTable'

const CARD_WRITE_FIELDS = [
  'card_number',
  'name',
  'description',
  'card_type',
  'cost',
  'attack',
  'health',
  'has_flip',
  'flip_description',
  'mechanics',
  'image_url',
  'card_url',
  'land_type',
  'is_rainbow',
  'rarity',
  'source',
  'hero',
  'notes',
]

function pickCardPayload(cardData) {
  const payload = {}
  for (const key of CARD_WRITE_FIELDS) {
    if (cardData[key] !== undefined) payload[key] = cardData[key]
  }
  return payload
}

function formatCardMutationError(error) {
  if (!error) return 'Не удалось сохранить карту'
  if (error.code === 'PGRST116') {
    return 'Карта не найдена или нет прав на изменение'
  }
  return error.message
}

export function useCards() {
  const { rows, setRows: setCards, loading, error, reload: loadCards } = useSupabaseTable(
    'cards',
    { orderBy: 'card_number', hookName: 'useCards' }
  )
  const cards = rows

  const createCard = useCallback(async (cardData) => {
    const payload = pickCardPayload(cardData)
    const { data, error: insertError } = await supabase
      .from('cards')
      .insert([payload])
      .select()
      .maybeSingle()
    if (insertError) return { success: false, error: formatCardMutationError(insertError) }
    if (!data) return { success: false, error: 'Карта не была создана' }
    setCards((prev) => [...prev, data])
    return { success: true, data }
  }, [setCards])

  const updateCard = useCallback(async (cardId, cardData) => {
    const payload = pickCardPayload(cardData)
    const { data, error: updateError } = await supabase
      .from('cards')
      .update(payload)
      .eq('id', cardId)
      .select()
      .maybeSingle()
    if (updateError) return { success: false, error: formatCardMutationError(updateError) }
    if (!data) return { success: false, error: 'Карта не найдена или нет прав на изменение' }
    setCards((prev) => prev.map((c) => (c.id === cardId ? data : c)))
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
