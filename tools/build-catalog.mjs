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

const cards = readdirSync(join(contentDir, 'cards'))
  .filter((file) => file.endsWith('.json'))
  .map((file) => readJson(join(contentDir, 'cards', file)))
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
      abilities: [],
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

// Structured hero abilities are engine code, not scan data: keep the two implemented heroes.
const HERO_ABILITIES = {
  hero_bmo: {
    kind: 'passive',
    trigger: 'start_of_turn',
    effect: { op: 'draw_cards', count: 1 },
    text: 'Дополнительный бесплатный добор карты в начале хода',
  },
  hero_billy: {
    kind: 'passive',
    trigger: 'start_of_turn',
    effect: { op: 'win_if_opponents_deck_empty' },
    text: 'Если к началу твоего хода колода каждого противника опустела — победа',
  },
};

const heroes = readdirSync(join(contentDir, 'heroes', 'heroes'))
  .filter((file) => file.endsWith('.json'))
  .map((file) => readJson(join(contentDir, 'heroes', 'heroes', file)))
  .filter((hero) => hero.typeCategory === 'hero')
  .map((hero) => {
    const text = hero.description ?? '';
    return {
      id: hero.id,
      name: hero.name,
      image: hero.image,
      ability: HERO_ABILITIES[hero.id] ?? { kind: 'passive', text },
      text,
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

const cardIds = new Set(cards.map((card) => card.id));
if (cardIds.size !== cards.length) fail('duplicate card ids');
const heroIds = new Set(heroes.map((hero) => hero.id));
if (heroIds.size !== heroes.length) fail('duplicate hero ids');

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'cards.json'), `${JSON.stringify(cards, null, 1)}\n`);
writeFileSync(join(outDir, 'heroes.json'), `${JSON.stringify(heroes, null, 1)}\n`);

const stats = {};
for (const card of cards) stats[card.type] = (stats[card.type] ?? 0) + 1;
console.log(`cards: ${cards.length}`, stats);
console.log(`heroes: ${heroes.length}`);
