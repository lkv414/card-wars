/**
 * useLandSetup — установка земель перед партией (перестановка + подтверждение).
 *
 * Worker (GameRoom Durable Object) — единственный авторитет. SQL-фоллбека нет.
 */
import { useCallback } from 'react'
import { runViaTransport, transportError, transportOk } from './runViaTransport'

export function useLandSetup(game, { transport } = {}) {
  const reorderLands = useCallback(
    async (landIds) => {
      if (!game?.id) return

      const ws = await runViaTransport(transport, 'reorder_lands', { landIds })
      const wsErr = transportError(ws)
      if (wsErr) throw new Error(wsErr.error)
      if (transportOk(ws)) return
      throw new Error('Перестановка земель недоступна (обновите сервер)')
    },
    [game?.id, transport]
  )

  const confirmLandSetup = useCallback(
    async ({ landIds = [], bypass = false } = {}) => {
      if (!game?.id) return

      const ws = await runViaTransport(transport, 'confirm_land_setup', { landIds, bypass })
      const wsErr = transportError(ws)
      if (wsErr) throw new Error(wsErr.error)
      if (transportOk(ws)) return
      throw new Error('Подтверждение земель недоступно (обновите сервер)')
    },
    [game?.id, transport]
  )

  return { reorderLands, confirmLandSetup }
}