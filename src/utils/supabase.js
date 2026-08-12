import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

/** Не даём fetch висеть бесконечно — иначе UI застревает в (pending). */
const FETCH_TIMEOUT_MS = 15_000

function fetchWithTimeout(input, init = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  const signals = [controller.signal]
  if (init.signal) {
    if (typeof AbortSignal !== 'undefined' && AbortSignal.any) {
      signals.push(init.signal)
    }
  }
  const signal =
    signals.length > 1 && typeof AbortSignal !== 'undefined' && AbortSignal.any
      ? AbortSignal.any(signals)
      : controller.signal

  return fetch(input, { ...init, signal }).finally(() => clearTimeout(timer))
}

export const isLocalSupabase = Boolean(
  supabaseUrl?.includes('127.0.0.1') || supabaseUrl?.includes('localhost'),
)

if (!supabaseUrl || !supabaseKey) {
  console.error(
    '[CardWars] Supabase не настроен: задайте VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY в .env или .env.local',
  )
} else if (import.meta.env.DEV) {
  console.info(`[CardWars] Supabase → ${supabaseUrl}`)
}

export const supabase = createClient(supabaseUrl ?? '', supabaseKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  global: {
    fetch: fetchWithTimeout,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
})
