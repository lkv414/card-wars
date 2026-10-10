/**
 * shared/game-engine/combat.ts — реэкспорт боевой системы из серверного движка.
 *
 * ВНИМАНИЕ: файл в workers/game-engine/combat.ts — единственный источник правды.
 */

export {
  canPlayerDealDamage,
  pickBattleTarget,
  resolveAttack,
} from '../../workers/src/game-engine/combat.js'

export { cardMatchesId, findCardInZone } from '../../workers/src/game-engine/combat.js'
