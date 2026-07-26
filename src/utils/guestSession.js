/**
 * guestSession — управление guest_id в Postgres-сеансе.
 *
 * Фаза 6: RLS-политики проверяют current_setting('app.guest_id', true).
 * Клиент должен вызвать set_guest_id() на сервере ПЕРЕД каждым запросом
 * (или хотя бы раз при старте сессии — PostgREST переиспользует сеанс).
 *
 * На практике вызываем ensureGuestId() при старте приложения, а потом
 * supabase-js сам переиспользует HTTP-соединение (с тем же сеансом).
 */
import { supabase } from './supabase.js'
import { getGuestId } from './guestId.js'

let lastSentId = null
let inflight = null

/**
 * Один раз за сессию отправляет guestId на сервер.
 * Идемпотентна — повторные вызовы с тем же id не делают запрос.
 * Гонки: если несколько вызовов стартуют параллельно до того, как
 * первый успеет присвоить lastSentId, inflight Promise разделяется
 * между ними — set_guest_id летит ровно один раз.
 */
export async function ensureGuestId() {
  const id = getGuestId()
  if (lastSentId === id) return
  if (inflight) return inflight

  inflight = (async () => {
    try {
      await supabase.rpc('set_guest_id', { p_guest_id: id })
      lastSentId = id
    } catch (err) {
      console.warn('set_guest_id failed (non-fatal):', err?.message || err)
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/**
 * Принудительно переустановить guestId (например, если он изменился).
 */
export async function resetGuestId() {
  lastSentId = null
  await ensureGuestId()
}
