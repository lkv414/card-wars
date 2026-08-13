/**
 * Ably Realtime client — token auth через Supabase Edge Function `ably-auth`.
 */
import Ably from 'ably'
import { getGuestId } from './guestId'
import { gameDebugLog } from './gameDebug'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
const AUTH_TIMEOUT_MS = 12_000

export const isAblyConfigured = Boolean(supabaseUrl && supabaseKey)

/** @type {import('ably').Realtime | null} */
let realtimeClient = null

/** @type {Map<string, import('ably').RealtimeChannel>} */
const channelCache = new Map()

/** @type {Promise<void> | null} */
let authInflight = null

/** Каналы, для которых уже запрошен capability (накопительный список для renew). */
const authorizedChannels = new Set()

function mapConnectionState(state) {
  if (state === 'connected') return 'connected'
  if (state === 'connecting' || state === 'initialized') return 'connecting'
  if (state === 'disconnected' || state === 'suspended' || state === 'failed') return 'disconnected'
  return 'connecting'
}

function resolveChannelNames(tokenParams = {}) {
  const names = new Set(authorizedChannels)
  const single = tokenParams.channelName || tokenParams.params?.channelName
  if (single) names.add(String(single))
  if (Array.isArray(tokenParams.channels)) {
    for (const ch of tokenParams.channels) names.add(String(ch))
  }
  return [...names]
}

async function fetchTokenRequest(tokenParams = {}) {
  const clientId = getGuestId()
  const channels = resolveChannelNames(tokenParams)
  if (channels.length === 0) {
    throw new Error('Ably auth: no channel names (refusing empty capability token)')
  }

  const body = { clientId, channels }
  gameDebugLog('ably', 'fetch token', { channels })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS)

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/ably-auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseKey}`,
        apikey: supabaseKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text()
      gameDebugLog('ably', 'fetch token failed', { status: res.status, body: text.slice(0, 200) })
      throw new Error(text || res.statusText)
    }
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

export function getAblyClient() {
  if (!isAblyConfigured) {
    throw new Error('Ably не настроен: задайте VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY')
  }

  if (realtimeClient) return realtimeClient

  realtimeClient = new Ably.Realtime({
    clientId: getGuestId(),
    closeOnUnload: true,
    echoMessages: false,
    autoConnect: false,
    authCallback: (tokenParams, callback) => {
      fetchTokenRequest(tokenParams)
        .then((tokenRequest) => callback(null, tokenRequest))
        .catch((err) => {
          console.warn('[ably] auth failed:', err?.message || err)
          gameDebugLog('ably', 'authCallback failed', { error: err?.message || String(err) })
          callback(err)
        })
    },
  })

  return realtimeClient
}

export function getAblyConnectionState() {
  if (!realtimeClient) return 'connecting'
  return mapConnectionState(realtimeClient.connection.state)
}

/** Запросить capability для канала(ов) и подключиться. */
export async function authorizeAblyChannel(channelName) {
  if (!channelName) return
  authorizedChannels.add(channelName)

  const client = getAblyClient()
  if (authInflight) await authInflight

  authInflight = (async () => {
    gameDebugLog('ably', 'authorize', { channelName, all: [...authorizedChannels] })
    try {
      const tokenRequest = await fetchTokenRequest({ channels: [...authorizedChannels] })
      await client.auth.authorize(tokenRequest)

      const state = client.connection.state
      if (state === 'initialized' || state === 'disconnected' || state === 'suspended') {
        client.connect()
      }
      gameDebugLog('ably', 'authorize ok', { channelName, connection: client.connection.state })
    } catch (err) {
      console.warn('[ably] authorize failed:', channelName, err?.message || err)
      gameDebugLog('ably', 'authorize failed', { channelName, error: err?.message || String(err) })
      throw err
    }
  })()

  try {
    await authInflight
  } finally {
    authInflight = null
  }
}

/** @returns {Promise<import('ably').RealtimeChannel>} */
export async function getAblyChannel(channelName, { rewind = false } = {}) {
  const cached = channelCache.get(channelName)
  if (cached?.state === 'attached') return cached

  await authorizeAblyChannel(channelName)

  const client = getAblyClient()
  let channel = channelCache.get(channelName)
  if (!channel) {
    const options = rewind ? { params: { rewind: '1' } } : undefined
    channel = client.channels.get(channelName, options)
    channelCache.set(channelName, channel)
  }

  if (channel.state !== 'attached') {
    await channel.attach()
  }
  return channel
}

export function releaseAblyChannel(channelName) {
  const channel = channelCache.get(channelName)
  if (!channel) return
  try {
    if (channel.state === 'attached') channel.detach()
  } catch {
    /* ignore detach race */
  }
  channelCache.delete(channelName)
}

export function closeAblyClient() {
  for (const name of [...channelCache.keys()]) {
    releaseAblyChannel(name)
  }
  authorizedChannels.clear()
  if (realtimeClient) {
    realtimeClient.close()
    realtimeClient = null
  }
}

export { mapConnectionState }
