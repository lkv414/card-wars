import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../utils/supabase'


export function useLands() {
  const [lands, setLands] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadLands = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase.from('lands').select('*').order('name')
    if (error) {
      console.error('Ошибка загрузки земель:', error)
      setError(error.message)
      setLands([])
    } else {
      setLands(data || [])
    }
    setLoading(false)
  }, [])

  // Оптимизация: insert/update уже возвращают объект — обновляем локально,
  // не делая повторный loadLands() (2 RTT → 1 RTT).
  const createLand = useCallback(async (landData) => {
    const { data, error } = await supabase.from('lands').insert([landData]).select().single()
    if (error) return { success: false, error: error.message }
    if (data) setLands((prev) => [...prev, data])
    return { success: true, data }
  }, [])

  const updateLand = useCallback(async (landId, landData) => {
    const { data, error } = await supabase.from('lands').update(landData).eq('id', landId).select().single()
    if (error) return { success: false, error: error.message }
    if (data) setLands((prev) => prev.map((l) => (l.id === landId ? data : l)))
    return { success: true, data }
  }, [])

  const deleteLand = useCallback(async (landId) => {
    const { error } = await supabase.from('lands').delete().eq('id', landId)
    if (error) return { success: false, error: error.message }
    setLands((prev) => prev.filter((l) => l.id !== landId))
    return { success: true }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(loadLands)
  }, [loadLands])

  return { lands, loading, error, loadLands, createLand, updateLand, deleteLand }
}
