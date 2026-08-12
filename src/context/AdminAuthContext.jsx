import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../utils/supabase'
import { isAdminUser } from '../utils/adminAuth'

const AdminAuthContext = createContext(null)

export function AdminAuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) {
        setSession(data.session ?? null)
        setLoading(false)
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { success: false, error: error.message }
    if (!isAdminUser(data.user)) {
      await supabase.auth.signOut()
      return { success: false, error: 'Нет прав администратора' }
    }
    setSession(data.session)
    return { success: true }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
  }, [])

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      isAdmin: isAdminUser(session?.user),
      loading,
      signIn,
      signOut,
    }),
    [session, loading, signIn, signOut]
  )

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext)
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider')
  return ctx
}
