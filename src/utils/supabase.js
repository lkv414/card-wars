import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

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
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
})
