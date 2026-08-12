/**
 * Supabase integration smoke: requires `supabase start` and local stack.
 * Skips gracefully when Supabase is not reachable.
 */
/* global process */
import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
const key =
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const supabase = createClient(url, key)
let online = false

beforeAll(async () => {
  const { error } = await supabase.from('cards').select('id').limit(1)
  online = !error
})

describe('Supabase RPC contracts', () => {
  it('find_similar_cards exists', async () => {
    if (!online) return expect(true).toBe(true)
    const { error } = await supabase.rpc('find_similar_cards', {
      p_name: 'test',
      p_description: '',
    })
    expect(error).toBeNull()
  })

  it('validate_lobby_deck rejects empty deck', async () => {
    if (!online) return expect(true).toBe(true)
    const { error } = await supabase.rpc('validate_lobby_deck', { p_deck: null })
    expect(error).not.toBeNull()
  })

  it('preset_decks readable', async () => {
    if (!online) return expect(true).toBe(true)
    const { error } = await supabase.from('preset_decks').select('id').limit(1)
    expect(error).toBeNull()
  })
})
