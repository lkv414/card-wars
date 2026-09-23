/**
 * guestSession — управление guest_id в Postgres-сеансе.
 *
 * Проблема (01.08.2026): PostgREST использует пул HTTP-соединений, и
 * `SET LOCAL app.guest_id = ...` (который делает RPC `set_guest_id`)
 * действует только до конца транзакции. Между запросами соединение
 * переиспользуется — НО `app.guest_id` сбрасывается на NULL. Из-за
 * этого RLS-политики, проверяющие `current_setting('app.guest_id')`,
 * могут ловить чужой guest_id из предыдущего запроса ИЛИ NULL → UPDATE
 * возвращает 0 затронутых строк, клиент видит "version conflict" и
 * уходит в бесконечный retry.
 *
 * Фикс (Этап 7): для каждого мутирующего RPC-вызова клиент должен
 * явно слать guest_id в параметрах RPC (например, `end_turn(p_game_id,
 * p_player_id)`). Для прямых UPDATE/INSERT в таблицы game_players /
 * game_zones — обёртка `withGuestId(fn)` дёргает `set_guest_id` ровно
 * перед запросом в той же сессии. RPC с SECURITY DEFINER (end_turn,
 * play_card, forfeit_game) внутри делают `PERFORM set_config(...)`,
 * так что им достаточно правильного p_player_id в параметрах.
 *
 * Поведение:
 *   - ensureGuestId() — отправляет guest_id один раз за сессию (идемпотентно).
 *     Для SECURITY DEFINER RPC это уже гарантирует корректную работу.
 *   - withGuestId(fn) — обёртка для прямых UPDATE/INSERT: перед fn
 *     принудительно дёргает `set_guest_id` чтобы соединение в пуле
 *     увидело свежий guest_id.
 */
import { supabase, isSupabaseConfigured } from './supabase.js'
import { isOfflineTestMode } from './offlineMode.js'
import { getGuestId } from './guestId.js'

let lastSentId = null
let inflight = null

const SET_GUEST_TIMEOUT_MS = 10_000

/**
 * Один раз за сессию отправляет guestId на сервер (через SET LOCAL).
 * Идемпотентна — повторные вызовы с тем же id не делают запрос.
 * Гонки: если несколько вызовов стартуют параллельно до того, как
 * первый успеет присвоить lastSentId, inflight Promise разделяется
 * между ними — set_guest_id летит ровно один раз.
 *
 * Если Supabase не сконфигурирован (нет VITE_SUPABASE_URL / PUBLISHABLE_KEY
 * в env, например в локальной разработке без .env), функция сразу
 * завершается без сетевых вызовов и без warning'ов. В проде env
 * всегда заполнен (через .env.production или Cloudflare Pages vars).
 */
export async function ensureGuestId() {
  if (isOfflineTestMode || !isSupabaseConfigured) return
  const id = getGuestId()
  if (lastSentId === id) return
  if (inflight) return inflight

  inflight = (async () => {
    try {
      const rpcPromise = supabase.rpc('set_guest_id', { p_guest_id: id })
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('set_guest_id timeout')), SET_GUEST_TIMEOUT_MS)
      })
      const { error } = await Promise.race([rpcPromise, timeoutPromise])
      if (error) throw error
      lastSentId = id
    } catch (err) {
      console.warn('set_guest_id failed (non-fatal):', err?.message || err)
      lastSentId = null
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/**
 * Принудительно сбросить кэш lastSentId (используется при logout или
 * после серьёзной ошибки RLS).
 */
export function resetGuestIdCache() {
  lastSentId = null
}

/**
 * Обёртка для прямых мутирующих запросов (UPDATE/INSERT в game_players,
 * game_zones и т.п.). Принудительно устанавливает guest_id в текущем
 * HTTP-соединении через `set_guest_id` RPC, потом выполняет переданный
 * запрос. На каждый вызов — новый RPC, потому что PostgREST может
 * перебросить соединение.
 *
 * Если Supabase не сконфигурирован, обёртка просто выполняет fn()
 * без вызова RPC.
 *
 * @template T
 * @param {() => Promise<T>} fn — функция, выполняющая supabase.from(...).update/insert
 * @returns {Promise<T>}
 */
export async function withGuestId(fn) {
  if (!isSupabaseConfigured) return fn()
  resetGuestIdCache()
  await ensureGuestId()
  return fn()
}