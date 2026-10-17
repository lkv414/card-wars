import fs from 'node:fs'

const file = 'individual_cards/cards.json'
const cards = JSON.parse(fs.readFileSync(file, 'utf8'))
const supportedActions = new Set([
  'deal_damage', 'aoe_damage', 'heal', 'draw_cards', 'discard_cards',
  'destroy', 'move', 'return_from_discard', 'stat_buff', 'gain_actions',
  'cost_reduction', 'play_for_free', 'face_attack',
  'freeze_landscape', 'flip_landscape', 'mill', 'search', 'peek', 'immunity',
])
const supportedTriggers = new Set([
  'manual', 'on_enters_play', 'on_flip', 'start_of_turn',
  'start_of_next_turn', 'end_of_turn', 'on_creature_attacks', 'on_draw',
  'conditional', 'persistent', 'on_line_change', 'on_death', 'on_damage_dealt',
])
const supportedConditions = new Set([
  'cost_actions', 'verb', 'if', 'while', 'prerequisite',
])

function implemented(card) {
  for (const mechanic of card.mechanics ?? []) {
    if (!supportedTriggers.has(mechanic.trigger)) return false
    for (const condition of mechanic.conditions ?? []) {
      if (!supportedConditions.has(condition.type)) return false
    }
    for (const action of mechanic.actions ?? []) {
      if (action.source_type || !supportedActions.has(action.type)) return false
    }
  }
  return true
}

for (const card of cards) {
  card.mechanics_version = 1
  card.mechanics_status = implemented(card) ? 'implemented' : 'text_only'
}
fs.writeFileSync(file, `${JSON.stringify(cards, null, 2)}\n`, 'utf8')
const counts = cards.reduce((acc, card) => {
  acc[card.mechanics_status] = (acc[card.mechanics_status] ?? 0) + 1
  return acc
}, {})
console.log(JSON.stringify({ cards: cards.length, counts }, null, 2))
// Also print how many became implemented by trigger
const byTrigger = {}
for (const c of cards) for (const m of c.mechanics ?? []) byTrigger[m.trigger] = (byTrigger[m.trigger]||0)+1
console.log('triggers:', JSON.stringify(byTrigger))
