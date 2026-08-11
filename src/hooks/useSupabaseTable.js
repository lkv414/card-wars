import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../utils/supabase'
import { logError, toUserFacingError } from '../utils/errorLogger'

function applyTableResponse(data, error, setRows, setError, setLoading, hookName, action) {
  if (error) {
    logError(error, { hook: hookName, action })
    setError(toUserFacingError(error))
    setRows([])
  } else {
    setRows(data || [])
    setError(null)
  }
  setLoading(false)
}

/**
 * Generic Supabase table fetch hook.
 * @param {string} table - table name
 * @param {{ orderBy: string, hookName: string }} options
 */
export function useSupabaseTable(table, { orderBy, hookName }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchQuery = useCallback(
    () => supabase.from(table).select('*').order(orderBy),
    [table, orderBy]
  )

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: fetchError } = await fetchQuery()
      applyTableResponse(data, fetchError, setRows, setError, setLoading, hookName, `load${table}`)
    } catch (err) {
      applyTableResponse(null, err, setRows, setError, setLoading, hookName, `load${table}`)
    }
  }, [fetchQuery, hookName, table])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const { data, error: fetchError } = await fetchQuery()
        if (cancelled) return
        applyTableResponse(data, fetchError, setRows, setError, setLoading, hookName, `load${table}`)
      } catch (err) {
        if (cancelled) return
        applyTableResponse(null, err, setRows, setError, setLoading, hookName, `load${table}`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [fetchQuery, hookName, table])

  return { rows, setRows, loading, error, reload }
}
