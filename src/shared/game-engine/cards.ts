/**
 * shared/game-engine/cards.ts — реэкспорт картовых действий из серверного движка.
 *
 * ВНИМАНИЕ: файл в workers/game-engine/cards.ts — единственный источник правды.
 */

export {
  playCard,
  drawFree,
  drawPaid,
  shuffleDeckAction,
  discardFromHand,
  discardFromZone,
  flipCard,
  clearFlipMarks,
  reorderLands,
  confirmLandSetup,
  canFlipCard,
  cardMatchesId,
  findCardInZone,
  replaceCardInZone,
} from '../../workers/src/game-engine/cards.js'
