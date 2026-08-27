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

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey)

if (!isSupabaseConfigured) {
  // Не сбрасываем dev-консоль ошибкой: когда env не заполнен (например,
  // локально без .env), приложение всё равно работает в offline-режиме
  // (multiplayer через Worker, каталог через KV с fallback на Supabase).
  // Подавляем сообщение в dev и показываем warning один раз в проде,
  // чтобы заметить случайную регрессию при следующем деплое.
  if (!import.meta.env.DEV) {
    console.warn(
      '[CardWars] Supabase не сконфигурирован: VITE_SUPABASE_URL или VITE_SUPABASE_PUBLISHABLE_KEY отсутствуют.',
    )
  }
} else if (import.meta.env.DEV) {
  console.info(`[CardWars] Supabase → ${supabaseUrl}`)
}

const clientOptions = {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  global: {
    fetch: fetchWithTimeout,
  },
}

let supabaseClient = null

function getSupabaseClient() {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase не настроен: задайте VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY',
    )
  }
  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabaseKey, clientOptions)
  }
  return supabaseClient
}

/** Lazy proxy — не падает при импорте, если env не заданы (Cloudflare build без vars). */
export const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = getSupabaseClient()
      const value = client[prop]
      return typeof value === 'function' ? value.bind(client) : value
    },
  },
)
