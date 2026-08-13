/** @typedef {import('./gameWebSocket.js').GameSocketClient} GameSocketClient */

/**
 * @param {object | null | undefined} transport
 * @param {string} action
 * @param {Record<string, unknown>} [payload]
 * @returns {Promise<{ viaWs: true, state?: object, error?: string } | { viaWs: false }>}
 */
export async function runViaTransport(transport, action, payload = {}) {
  if (!transport?.enabled || typeof transport.sendActionAsync !== 'function') {
    return { viaWs: false }
  }
  try {
    const state = await transport.sendActionAsync(action, payload)
    return { viaWs: true, state }
  } catch (err) {
    return { viaWs: true, error: err?.message || String(err) }
  }
}

export function transportError(result) {
  if (result?.viaWs && result.error) return { error: result.error }
  return null
}

export function transportOk(result, extra = {}) {
  if (result?.viaWs && !result.error) {
    return { success: true, state: result.state, ...extra }
  }
  return null
}
