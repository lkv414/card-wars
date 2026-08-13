import Ably from 'npm:ably@2'
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** @param {string} channelName */
function parseChannel(channelName) {
  const match = /^((?:game|lobby)):([0-9a-f-]{36})$/i.exec(channelName || '')
  if (!match) return null
  return { kind: match[1].toLowerCase(), id: match[2] }
}

/** @param {import('@supabase/supabase-js').SupabaseClient} supabase @param {string} clientId @param {string} channelName */
async function verifyChannelAccess(supabase, clientId, channelName) {
  const parsed = parseChannel(channelName)
  if (!parsed || !clientId) return false

  if (parsed.kind === 'game') {
    const { data } = await supabase
      .from('game_players')
      .select('player_id')
      .eq('game_id', parsed.id)
      .eq('player_id', clientId)
      .maybeSingle()
    return Boolean(data)
  }

  if (parsed.kind === 'lobby') {
    const { data: member } = await supabase
      .from('lobby_players')
      .select('player_id')
      .eq('lobby_id', parsed.id)
      .eq('player_id', clientId)
      .maybeSingle()
    if (member) return true

    const { data: lobby } = await supabase
      .from('lobbies')
      .select('host_id')
      .eq('id', parsed.id)
      .maybeSingle()
    return lobby?.host_id === clientId
  }

  return false
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const ablyKey = Deno.env.get('ABLY_API_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!ablyKey || !supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  let body
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  const clientId = String(body.clientId || '').trim()
  if (!clientId) {
    return jsonResponse({ error: 'clientId required' }, 400)
  }

  const channelNames = new Set()
  if (body.channelName) channelNames.add(String(body.channelName))
  if (Array.isArray(body.channels)) {
    for (const ch of body.channels) channelNames.add(String(ch))
  }

  if (channelNames.size === 0) {
    return jsonResponse({ error: 'channelName or channels required' }, 400)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  /** @type {Record<string, string[]>} */
  const capability = {}

  for (const name of channelNames) {
    const allowed = await verifyChannelAccess(supabase, clientId, name)
    if (!allowed) {
      return jsonResponse({ error: `Forbidden channel: ${name}` }, 403)
    }
    capability[name] = ['subscribe', 'publish', 'presence']
  }

  // Пустой capability — Ably всё равно выдаст token; повторный auth при attach канала.
  const ably = new Ably.Rest({ key: ablyKey })
  const tokenRequest = await ably.auth.createTokenRequest({
    clientId,
    capability: JSON.stringify(capability),
    ttl: 60 * 60 * 1000,
  })

  return jsonResponse(tokenRequest)
})
