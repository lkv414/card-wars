/**
 * Ably Realtime client — token auth через Supabase Edge Function `ably-auth`.
 */
import Ably from 'ably'
import { getGuestId } from './guestId'

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

function mapConnectionState(state) {
  if (state === 'connected') return 'connected'
  if (state === 'connecting' || state === 'initialized') return 'connecting'
  if (state === 'disconnected' || state === 'suspended' || state === 'failed') return 'disconnected'
  return 'connecting'
}

function resolveChannelName(tokenParams = {}) {
  if (tokenParams.channelName) return String(tokenParams.channelName)
  if (tokenParams.params?.channelName) return String(tokenParams.params.channelName)
  if (Array.isArray(tokenParams.channels) && tokenParams.channels.length > 0) {
    return String(tokenParams.channels[0])
  }
  return null
}

async function fetchTokenRequest(tokenParams = {}) {
  const clientId = getGuestId()
  const body = { clientId }
  const channelName = resolveChannelName(tokenParams)
  if (channelName) body.channelName = channelName
  if (Array.isArray(tokenParams.channels)) body.channels = tokenParams.channels

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
    authCallback: (tokenParams, callback) => {
      fetchTokenRequest(tokenParams)
        .then((tokenRequest) => callback(null, tokenRequest))
        .catch((err) => {
          console.warn('[ably] auth failed:', err?.message || err)
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

/** Запросить capability для канала до attach. */
export async function authorizeAblyChannel(channelName) {
  const client = getAblyClient()
  if (authInflight) await authInflight
  authInflight = client.auth
    .authorize({ clientId: getGuestId(), channelName })
    .then(
    () => {},
    (err) => {
      console.warn('[ably] authorize failed:', channelName, err?.message || err)
      throw err
    }
  )
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
  if (realtimeClient) {
    realtimeClient.close()
    realtimeClient = null
  }
}

export { mapConnectionState }
