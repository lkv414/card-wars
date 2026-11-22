// Builds the @card-wars/content catalog from content/: per-card JSON / index.json -> cards.json / heroes.json.
// Run: node tools/build-catalog.mjs (or pnpm --filter @card-wars/content generate).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const contentDir = join(root, 'content');
const outDir = join(root, 'packages/content/src/generated');

const LAND_TYPES = new Set(['corn', 'blue', 'good', 'ice', 'sand', 'swamp', 'rainbow', 'lava']);
const CARD_TYPES = new Set(['creature', 'building', 'spell', 'companion']);

const LAND_MAP = {
  swamp: 'swamp',
  corn: 'corn',
  blue: 'blue',
  nice: 'good',
  good: 'good',
  rainbow: 'rainbow',
  sand: 'sand',
  sandy: 'sand',
  ice: 'ice',
  icy: 'ice',
  lava: 'lava',
  ghost: 'lava',
};

const TYPE_MAP = {
  creature: 'creature',
  spell: 'spell',
  building: 'building',
  teamwork: 'companion',
  companion: 'companion',
};

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function fail(message) {
  console.error(`build-catalog: ${message}`);
  process.exit(1);
}

const indexData = readJson(join(contentDir, 'index.json'));

const rawCards = indexData.filter((x) => x.kind === 'card');
const rawHeroes = indexData.filter((x) => x.kind === 'hero');

const cards = rawCards
  .map((card) => {
    const type = TYPE_MAP[card.typeCategory];
    if (!type || !CARD_TYPES.has(type)) fail(`unknown typeCategory ${card.typeCategory} (${card.id})`);

    const landType = LAND_MAP[card.landType];
    if (!landType || !LAND_TYPES.has(landType)) fail(`unknown landType ${card.landType} (${card.id})`);

    if (!Number.isInteger(card.cost) || card.cost < 0) fail(`bad cost (${card.id})`);

    const record = {
      id: card.id,
      name: card.name,
      type,
      cost: card.cost,
      landType,
      image: card.image,
    };

    if (type === 'creature') {
      record.attack = typeof card.attack === 'number' ? card.attack : 0;
      record.defense = typeof card.defense === 'number' ? card.defense : 0;
    }

    if (card.description) record.description = card.description;
    if (card.abilities && card.abilities.length) record.abilities = card.abilities;
    if (card.set_code || card.deckSet) record.deckSet = card.set_code || card.deckSet;
    if (card.rumble !== undefined) {
      record.rumble = Boolean(card.rumble);
    } else if (card.description && /грохот/i.test(card.description)) {
      record.rumble = true;
    }

    return record;
  })
  .sort((a, b) => a.id.localeCompare(b.id));

const heroes = rawHeroes
  .map((hero) => {
    const record = {
      id: hero.id,
      name: hero.name,
      image: hero.image,
      text: hero.description || '',
    };
    if (hero.ability) record.ability = hero.ability;
    if (hero.wordSetup) record.wordSetup = hero.wordSetup;
    return record;
  })
  .sort((a, b) => a.id.localeCompare(b.id));

const cardIds = new Set(cards.map((c) => c.id));
if (cardIds.size !== cards.length) fail(`duplicate card ids: ${cards.length - cardIds.size}`);

const heroIds = new Set(heroes.map((h) => h.id));
if (heroIds.size !== heroes.length) fail(`duplicate hero ids: ${heroes.length - heroIds.size}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'cards.json'), `${JSON.stringify(cards, null, 2)}\n`);
writeFileSync(join(outDir, 'heroes.json'), `${JSON.stringify(heroes, null, 2)}\n`);

const stats = {};
for (const card of cards) stats[card.type] = (stats[card.type] ?? 0) + 1;
console.log(`Generated cards: ${cards.length}`, stats);
console.log(`Generated heroes: ${heroes.length}`);

const withMechanics = cards.filter((c) => c.abilities?.length).length;
console.log(`Mechanics: cards ${withMechanics}/${cards.length} structured, heroes ${heroes.filter((h) => h.ability).length}/${heroes.length}`);
