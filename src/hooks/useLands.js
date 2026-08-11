import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../utils/supabase'
import { logError, toUserFacingError } from '../utils/errorLogger'

function applyLandsResponse(data, error, setLands, setError, setLoading) {
  if (error) {
    logError(error, { hook: 'useLands', action: 'loadLands' })
    setError(toUserFacingError(error))
    setLands([])
  } else {
    setLands(data || [])
    setError(null)
  }
  setLoading(false)
}

export function useLands() {
  const [lands, setLands] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchLands = useCallback(
    () => supabase.from('lands').select('*').order('name'),
    [],
  )

  const loadLands = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: fetchError } = await fetchLands()
      applyLandsResponse(data, fetchError, setLands, setError, setLoading)
    } catch (err) {
      applyLandsResponse(null, err, setLands, setError, setLoading)
    }
  }, [fetchLands])

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
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const { data, error: fetchError } = await fetchLands()
        if (cancelled) return
        applyLandsResponse(data, fetchError, setLands, setError, setLoading)
      } catch (err) {
        if (cancelled) return
        applyLandsResponse(null, err, setLands, setError, setLoading)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [fetchLands])

  return { lands, loading, error, loadLands, createLand, updateLand, deleteLand }
}
