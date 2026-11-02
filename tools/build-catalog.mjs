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

const EFFECT_OPS = new Set(['deal_damage', 'draw_cards', 'stat_buff', 'gain_shield', 'gain_actions']);
const TRIGGERS = new Set([
  'on_cast', 'on_enters_play', 'on_death', 'start_of_turn', 'start_of_next_turn',
  'on_creature_attacks', 'on_damage_dealt', 'on_line_change', 'on_flip', 'on_draw',
  'on_spell_cast', 'on_card_played', 'start_of_battle_phase', 'on_companion_event',
]);
const TARGET_ASKS = new Set(['own_creature', 'opponent_creature', 'any_creature', 'opponent_player', 'landscape', 'own_hand_card']);

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
  const hasEffect = ability.effect !== undefined;
  const hasMechanic = ability.mechanic !== undefined;
  if (hasEffect === hasMechanic) fail(`${where}: exactly one of effect|mechanic`);
  if (hasEffect) {
    const op = ability.effect.op;
    if (!EFFECT_OPS.has(op)) fail(`${where}: unknown effect op ${op}`);
    if (op !== 'draw_cards' && op !== 'gain_actions' && !ability.effect.target) fail(`${where}: op ${op} needs a target`);
    if (op === 'stat_buff' && !['permanent', 'aura'].includes(ability.effect.duration)) {
      fail(`${where}: stat_buff duration must be permanent|aura`);
    }
  }
  for (const ask of ability.targets ?? []) {
    if (!TARGET_ASKS.has(ask.kind)) fail(`${where}: unknown target ask ${ask.kind}`);
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
