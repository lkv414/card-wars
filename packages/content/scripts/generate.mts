// Stage-3 generator: converts the raw data files into canonical JSON committed
// to the repo. Run: node scripts/generate.mts (from packages/content).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertRawCards, convertRawHeroes, type RawCard, type RawHero } from '../src/convert.ts';

const here = dirname(fileURLToPath(import.meta.url));
const rawCards = JSON.parse(readFileSync(resolve(here, '../../../docs/data/cards_test_v1.json'), 'utf8')) as RawCard[];
const rawHeroes = JSON.parse(readFileSync(resolve(here, '../../../docs/data/heroes_original_v1.json'), 'utf8')) as RawHero[];

const { cards, stats } = convertRawCards(rawCards);

// Implemented hero abilities: the v3 docs are the source of truth (docs/RULES.md «Герои»).
const heroes = convertRawHeroes(rawHeroes, {
  bimo: {
    ability: {
      kind: 'passive',
      trigger: 'start_of_turn',
      effect: { op: 'draw_cards', count: 1 },
      text: 'Дополнительный бесплатный добор карты в начале хода',
    },
  },
  billy: {
    ability: {
      kind: 'passive',
      trigger: 'start_of_turn',
      effect: { op: 'win_if_opponents_deck_empty' },
      text: 'Если к началу твоего хода колода каждого противника опустела — победа',
    },
  },
});

mkdirSync(resolve(here, '../src/generated'), { recursive: true });
writeFileSync(resolve(here, '../src/generated/cards.json'), `${JSON.stringify(cards, null, 1)}\n`);
writeFileSync(resolve(here, '../src/generated/heroes.json'), `${JSON.stringify(heroes, null, 1)}\n`);

console.log(`cards: ${stats.converted}/${stats.total} converted (unknown types skipped: ${stats.skippedUnknownType})`);
console.log(`structured abilities mapped: ${stats.abilitiesMapped}`);
console.log(`heroes: ${heroes.length}`);
