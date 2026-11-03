// Builds the @card-wars/content catalog from content/: per-card JSON -> cards.json/heroes.json.
// Run: node tools/build-catalog.mjs (or pnpm --filter @card-wars/content generate).
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const contentDir = join(root, 'content');
const outDir = join(root, 'packages/content/src/generated');

const LAND_TYPES = new Set(['corn', 'blue', 'good', 'ice', 'sand', 'swamp', 'rainbow', 'ghost']);
const CARD_TYPES = new Set(['creature', 'building', 'spell', 'companion']);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function fail(message) {
  console.error(`build-catalog: ${message}`);
  process.exit(1);
}

function cardOrder(id) {
  const match = /^(.+)_card_(\d+)$/.exec(id);
  return match ? [match[1], Number(match[2])] : [id, 0];
}

// Printed "X" stats (e.g. ftg_card_46) mean a variable base; the engine needs a number.
function statValue(value, id, key) {
  if (value == null) return undefined;
  if (typeof value === 'number') return value;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  console.warn(`build-catalog: ${id} ${key}="${value}" -> 0`);
  return 0;
}

const cards = readdirSync(join(contentDir, 'cards', 'json'))
  .filter((file) => file.endsWith('.json'))
  .map((file) => readJson(join(contentDir, 'cards', 'json', file)))
  .map((card) => {
    if (!CARD_TYPES.has(card.typeCategory)) fail(`unknown typeCategory ${card.typeCategory} (${card.id})`);
    if (!LAND_TYPES.has(card.landType)) fail(`unknown landType ${card.landType} (${card.id})`);
    if (!Number.isInteger(card.cost) || card.cost < 0) fail(`bad cost (${card.id})`);
    const record = {
      id: card.id,
      name: card.name,
      type: card.typeCategory,
      cost: card.cost,
      landType: card.landType,
      image: card.image,
    };
    if (card.attack != null) record.attack = statValue(card.attack, card.id, 'attack');
    if (card.defense != null) record.defense = statValue(card.defense, card.id, 'defense');
    if (card.description) record.description = card.description;
    if (card.deckSet) record.deckSet = card.deckSet;
    return record;
  })
  .sort((a, b) => {
    const [deckA, numA] = cardOrder(a.id);
    const [deckB, numB] = cardOrder(b.id);
    return deckA.localeCompare(deckB) || numA - numB;
  });

// --- Mechanics v2 binding (docs/MECHANICS-V2.md §4) ---

const EFFECT_OPS = new Set(['deal_damage', 'heal', 'draw_cards', 'discard_top_deck', 'opponent_discards', 'stat_buff', 'gain_shield', 'gain_actions', 'flip_land', 'destroy', 'move_creature', 'freeze_land', 'win_if_opponents_deck_empty', 'cost_mod', 'land_count_mod', 'suppress', 'no_retaliation', 'damage_immunity', 'damage_redirect', 'grant_modifier', 'return_from_discard', 'discard_from_hand', 'grant_ability', 'return_to_owner', 'reveal_deck_top', 'resolve_revealed', 'counts_as', 'attack_mod', 'defense_mod', 'remove_token', 'transfer_token', 'grant_discount', 'ban_spells_next_turn']);
const TRIGGERS = new Set([
  'on_cast', 'on_enters_play', 'on_leave_play', 'on_death', 'start_of_turn', 'start_of_next_turn',
  'on_creature_attacks', 'on_damage_dealt', 'on_line_change', 'on_flip', 'on_draw',
  'on_spell_cast', 'on_card_played', 'start_of_battle_phase', 'on_companion_event',
]);
const TARGET_ASKS = new Set(['own_creature', 'opponent_creature', 'any_creature', 'lane_creature', 'lane_opponent_creature', 'opponent_player', 'landscape', 'own_hand_card', 'own_building', 'lane_building', 'own_landscape', 'adjacent_creature', 'adjacent_any_creature', 'revealed_card']);
const TARGET_REFS = new Set([
  'choice', 'this_creature', 'each_creature_of_choice_player', 'adjacent_own_land', 'this_lane_creature', 'this_lane_own_creature', 'this_lane_opponent_creature', 'this_lane_opponent_building', 'this_lane_land', 'this_lane_lands', 'active_opponent_players',
  'adjacent_creatures', 'each_creature_yours', 'each_creature_opponent', 'each_creature',
  'each_building_yours', 'each_player', 'each_opponent_player', 'self_player', 'teammate_player', 'opponent_team', 'triggering_instance', 'payload_partner',
]);
const AMOUNT_KINDS = new Set(['per_discard', 'per_damage', 'per_distinct_lands', 'per_lands', 'per_target', 'per_counter', 'payload_damage', 'per_token_players']);
const CONDITION_KINDS = new Set([
  'if_discard_count', 'while_discard_count', 'while_undamaged', 'while_damage_exactly',
  'while_damage_at_least', 'while_lane_empty_opponent', 'while_on_land_type',
  'while_distinct_lands', 'while_land_count', 'while_zone_has_building',
  'while_self_flipped', 'while_opponents_hand_empty', 'while_no_other_creatures',
  'while_empty_lands', 'while_on_flipped_land',
  'if_payload_replacing', 'if_payload_land_type', 'if_payload_cost', 'if_payload_player_self', 'if_payload_other',
  'if_payload_to_player', 'if_payload_targeted_self', 'if_payload_player_opponent', 'while_opponents_turn',
  'if_payload_ally', 'if_payload_creature', 'if_payload_enemy_creature', 'if_payload_targets_creature',
  'if_payload_team_target', 'if_payload_opponent_target',
  'while_phase', 'while_counter_at_least', 'while_counter_at_most', 'while_lane_ice_token', 'while_own_turn', 'while_no_tokens_in_play', 'while_zone_ice_token', 'while_own_card_in_play',
]);

function checkAmount(amount, where) {
  if (typeof amount === 'number') return;
  if (!amount || !AMOUNT_KINDS.has(amount.kind)) fail(`${where}: bad amount ${JSON.stringify(amount)}`);
}

function checkTargetRef(ref, where) {
  if (!ref || !TARGET_REFS.has(ref.kind)) fail(`${where}: bad target ${JSON.stringify(ref)}`);
}

function validateAbility(ability, owner) {
  const where = `${owner} ability`;
  if (!ability || (ability.kind !== 'passive' && ability.kind !== 'active')) fail(`${where}: kind must be passive|active`);
  if (typeof ability.text !== 'string' || ability.text.length === 0) fail(`${where}: text required`);
  if (ability.kind === 'passive' && ability.trigger !== undefined && !TRIGGERS.has(ability.trigger)) {
    fail(`${where}: unknown trigger ${ability.trigger}`);
  }
  if (ability.kind === 'active' && ability.trigger !== undefined) fail(`${where}: active ability must not have a trigger`);
  if (ability.cost !== undefined && (ability.kind !== 'active' || !Number.isInteger(ability.cost) || ability.cost < 0)) {
    fail(`${where}: cost is an active-only non-negative integer`);
  }
  const effects = Array.isArray(ability.effect) ? ability.effect : ability.effect ? [ability.effect] : [];
  const hasEffect = effects.length > 0;
  const hasMechanic = ability.mechanic !== undefined;
  // Passive: exactly one of effect|mechanic. Active: at most one — a bare
  // «ПРИЕМ» without effect is a tap-only floop (Огненное торнадо).
  if (ability.kind === 'passive' && hasEffect === hasMechanic && !(ability.conditions?.length > 0)) fail(`${where}: exactly one of effect|mechanic (or a conditions-only play gate)`);
  if (ability.kind === 'active' && hasEffect && hasMechanic) fail(`${where}: active must not have both effect and mechanic`);
  for (const effect of effects) validateEffect(effect, where, ability);
  for (const cond of ability.conditions ?? []) {
    if (!CONDITION_KINDS.has(cond.kind)) fail(`${where}: unknown condition ${cond.kind}`);
  }
  for (const ask of ability.targets ?? []) {
    if (!TARGET_ASKS.has(ask.kind)) fail(`${where}: unknown target ask ${ask.kind}`);
    if (ask.filter) {
      for (const key of Object.keys(ask.filter)) {
        if (!['ready', 'landType', 'zoneToken'].includes(key)) fail(`${where}: unknown ask filter ${key}`);
      }
    }
  }
}

function validateEffect(effect, where, ability) {
  const op = effect.op;
  if (!EFFECT_OPS.has(op)) fail(`${where}: unknown effect op ${op}`);
  if (op === 'cost_mod') {
    if (effect.self !== true) fail(`${where}: cost_mod must be self`);
    checkAmount(effect.amount, where);
  } else if (op === 'land_count_mod') {
    if (!Number.isInteger(effect.amount)) fail(`${where}: land_count_mod needs integer amount`);
  } else if (op === 'win_if_opponents_deck_empty') {
    // no parameters
  } else if (op === 'flip_land') {
    checkTargetRef(effect.target, where);
    if (typeof effect.down !== 'boolean') fail(`${where}: flip_land needs boolean down`);
    if (effect.until !== undefined && effect.until !== 'next_own_turn') fail(`${where}: flip_land until must be next_own_turn`);
  } else if (op === 'grant_discount') {
    if (!['spell', 'creature', 'building'].includes(effect.cardType)) fail(`${where}: grant_discount cardType invalid`);
    if (!Number.isInteger(effect.amount)) fail(`${where}: grant_discount needs integer amount`);
  } else if (op === 'ban_spells_next_turn') {
    // no parameters
  } else if (op === 'defense_mod') {
    checkTargetRef(effect.target, where);
    if (!Number.isInteger(effect.atkBonus)) fail(`${where}: defense_mod needs integer atkBonus`);
    if (effect.landType && !LAND_TYPES.has(effect.landType)) fail(`${where}: defense_mod landType invalid`);
  } else if (op === 'remove_token') {
    checkTargetRef(effect.target, where);
  } else if (op === 'transfer_token') {
    checkTargetRef(effect.target, where);
    checkTargetRef(effect.destination, where);
  } else if (op === 'destroy' || op === 'freeze_land') {
    checkTargetRef(effect.target, where);
    if (op === 'freeze_land' && typeof effect.frozen !== 'boolean') fail(`${where}: freeze_land needs boolean frozen`);
  } else if (op === 'suppress' || op === 'no_retaliation' || op === 'damage_immunity' || op === 'damage_redirect') {
    const target = effect.target ?? effect.from;
    checkTargetRef(target, where);
    if (op === 'damage_immunity' && !Number.isInteger(effect.amount)) fail(`${where}: damage_immunity needs integer amount`);
    if (op === 'suppress' && !effect.actives && !effect.triggers && !effect.all && !effect.attacks) fail(`${where}: suppress needs actives, triggers, all or attacks`);
  } else if (op === 'grant_modifier') {
    if (!effect.modifier || !EFFECT_OPS.has(effect.modifier.op)) fail(`${where}: grant_modifier needs a modifier effect`);
  } else if (op === 'grant_ability') {
    checkTargetRef(effect.target, where);
    if (!effect.ability || typeof effect.ability !== 'object') fail(`${where}: grant_ability needs an ability`);
    if (effect.ability && effect.ability.kind !== 'active') fail(`${where}: grant_ability grants an active ability`);
  } else if (op === 'return_from_discard') {
    checkAmount(effect.count, where);
  } else if (op === 'return_to_owner') {
    checkTargetRef(effect.target, where);
  } else if (op === 'attack_mod') {
    checkTargetRef(effect.target, where);
    if (effect.vs && !['ownZone', 'defenderZone'].includes(effect.vs)) fail(`${where}: attack_mod vs must be ownZone|defenderZone`);
    if (effect.landType && !LAND_TYPES.has(effect.landType)) fail(`${where}: attack_mod landType invalid`);
    if (!effect.multiplier && !effect.atkBonus && !effect.face) fail(`${where}: attack_mod needs multiplier|atkBonus|face`);
  } else if (op === 'counts_as') {
    checkTargetRef(effect.target, where);
    if (!LAND_TYPES.has(effect.landType)) fail(`${where}: counts_as needs a land type`);
  } else if (op === 'reveal_deck_top') {
    if (!Number.isInteger(effect.count)) fail(`${where}: reveal_deck_top needs integer count`);
  } else if (op === 'resolve_revealed') {
    checkTargetRef(effect.target, where);
    if (!['deck_bottom', 'hand'].includes(effect.to)) fail(`${where}: resolve_revealed to must be deck_bottom|hand`);
  } else if (op === 'discard_from_hand') {
    if (!Number.isInteger(effect.count)) fail(`${where}: discard_from_hand needs integer count`);
  } else if (op === 'move_creature') {
    checkTargetRef(effect.target, where);
    checkTargetRef(effect.destination, where);
    if (!['own', 'any'].includes(effect.side)) fail(`${where}: move_creature side must be own|any`);
  } else if (op === 'gain_actions') {
    if (!Number.isInteger(effect.amount)) fail(`${where}: gain_actions needs integer amount`);
  } else if (op === 'gain_shield') {
    checkTargetRef(effect.target, where);
    if (!Number.isInteger(effect.amount)) fail(`${where}: gain_shield needs integer amount`);
  } else if (op === 'opponent_discards') {
    checkTargetRef(effect.target, where);
    checkAmount(effect.count, where);
  } else if (op === 'draw_cards' || op === 'discard_top_deck') {
    checkAmount(effect.count, where);
  } else if (op === 'stat_buff') {
    if (!['attack', 'defense'].includes(effect.stat)) fail(`${where}: stat_buff stat must be attack|defense`);
    if (!['permanent', 'aura', 'this_turn'].includes(effect.duration)) fail(`${where}: stat_buff duration must be permanent|aura|this_turn`);
    checkAmount(effect.amount, where);
    if (effect.floorAttack !== undefined && !Number.isInteger(effect.floorAttack)) fail(`${where}: stat_buff floorAttack must be an integer`);
    if (effect.floorDefense !== undefined && !Number.isInteger(effect.floorDefense)) fail(`${where}: stat_buff floorDefense must be an integer`);
  } else {
    checkTargetRef(effect.target, where);
    checkAmount(effect.amount, where);
  }
  // A choice-based effect needs declared asks on ITS ability: max index + 1.
  // Inside grant_ability the asks live on the granted ability.
  const holder = op === 'grant_ability' ? effect.ability : ability;
  const effectJson = JSON.stringify(effect);
  const choiceMatches = [...effectJson.matchAll(/"choice","index":(\d+)/g)];
  if (choiceMatches.length > 0) {
    const need = Math.max(...choiceMatches.map((m) => Number(m[1]) + 1));
    if ((holder.targets?.length ?? 0) < need) {
      fail(`${where}: effect uses choice(0..${need - 1}) but only ${holder.targets?.length ?? 0} targets declared`);
    }
  }
}

/** Read a mechanics dir (optional): one file per card/hero, validated and keyed by id. */
function readMechanics(dir, ids, nameOf, keyField, single) {
  let entries;
  try {
    entries = readdirSync(dir).filter((file) => file.endsWith('.json'));
  } catch {
    return new Map();
  }
  const map = new Map();
  for (const file of entries) {
    const record = readJson(join(dir, file));
    const id = record[keyField];
    if (!ids.has(id)) fail(`${file}: unknown ${keyField} ${id}`);
    if (map.has(id)) fail(`${file}: duplicate mechanics for ${id}`);
    const name = nameOf(id);
    if (record.name && record.name !== name) {
      console.warn(`build-catalog: ${file} name "${record.name}" != catalog "${name}"`);
    }
    if (single) {
      validateAbility(record.ability, id);
      if (record.ability.kind === 'passive' && record.ability.trigger === undefined && !record.ability.effect) {
        // text-only placeholder is allowed until the ability is structured
      }
    } else {
      if (!Array.isArray(record.abilities) || record.abilities.length === 0) fail(`${file}: abilities[] required`);
      const actives = record.abilities.filter((a) => a.kind === 'active');
      if (actives.length > 1) fail(`${file}: at most one active (ПРИЕМ) ability per card`);
      record.abilities.forEach((ability, i) => validateAbility(ability, `${id}[${i}]`));
    }
    map.set(id, single ? record.ability : record.abilities);
  }
  return map;
}

// Hero data is display-only for now: the ability field returns with mechanics v2
// (docs/TECH.md № 2), when structured hero mechanics are bound per hero id.
const heroes = readdirSync(join(contentDir, 'heroes', 'json'))
  .filter((file) => file.endsWith('.json'))
  .map((file) => readJson(join(contentDir, 'heroes', 'json', file)))
  .filter((hero) => hero.typeCategory === 'hero')
  .map((hero) => ({
    id: hero.id,
    name: hero.name,
    image: hero.image,
    text: hero.description ?? '',
  }))
  .sort((a, b) => a.id.localeCompare(b.id));

const cardIds = new Set(cards.map((card) => card.id));
if (cardIds.size !== cards.length) fail('duplicate card ids');
const heroIds = new Set(heroes.map((hero) => hero.id));
if (heroIds.size !== heroes.length) fail('duplicate hero ids');

// Merge mechanics bindings into the generated catalog (docs/MECHANICS-V2.md §4).
const cardMechanics = readMechanics(
  join(contentDir, 'cards', 'mechanics'),
  cardIds,
  (id) => cards.find((c) => c.id === id).name,
  'cardId',
  false,
);
const heroMechanics = readMechanics(
  join(contentDir, 'heroes', 'mechanics'),
  heroIds,
  (id) => heroes.find((h) => h.id === id).name,
  'heroId',
  true,
);
for (const card of cards) {
  const abilities = cardMechanics.get(card.id);
  if (abilities) card.abilities = abilities;
}
for (const hero of heroes) {
  const ability = heroMechanics.get(hero.id);
  if (ability) hero.ability = ability;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'cards.json'), `${JSON.stringify(cards, null, 1)}\n`);
writeFileSync(join(outDir, 'heroes.json'), `${JSON.stringify(heroes, null, 1)}\n`);

const stats = {};
for (const card of cards) stats[card.type] = (stats[card.type] ?? 0) + 1;
console.log(`cards: ${cards.length}`, stats);
console.log(`heroes: ${heroes.length}`);

// Mechanics coverage (docs/MECHANICS-V2.md §4): what is structured vs pending.
const withMechanics = cards.filter((c) => c.abilities?.length).length;
const structurable = cards.filter((c) => !c.abilities && c.description).length;
console.log(
  `mechanics: cards ${withMechanics}/${cards.length} structured, ${structurable} with text pending, ` +
    `heroes ${heroes.filter((h) => h.ability).length}/${heroes.length}`,
);
