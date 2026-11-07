import fs from 'node:fs';
let s = fs.readFileSync('tools/build-catalog.mjs', 'utf8');
const rep = (from, to) => {
  if (!s.includes(from)) { console.error('MISS:', JSON.stringify(from.slice(0, 70))); process.exit(1); }
  s = s.split(from).join(to);
};
rep(
  "'attached_cards', 'opponent_discard_top', 'choice_zone_creature',\n]);",
  "'attached_cards', 'opponent_discard_top', 'choice_zone_creature', 'choice_zone_land', 'choice_zone_opponent_creature', 'peeked_cards',\n]);",
);
rep(
  "'attached_count', 'per_opponent_distinct_lands', 'chosen_card_cost']);",
  "'attached_count', 'per_opponent_distinct_lands', 'chosen_card_cost', 'team_companion_cost', 'lives_ladder']);",
);
rep(
  "'while_opponents_hand_at_least', 'if_option',\n]);",
  "'while_opponents_hand_at_least', 'if_option', 'while_team_creature_on_token_land', 'while_adjacent_lanes_empty', 'while_opponent_controls_own_creature',\n]);",
);
fs.writeFileSync('tools/build-catalog.mjs', s);
console.log('ok');
