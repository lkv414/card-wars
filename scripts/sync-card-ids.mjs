/**
 * sync-card-ids.mjs — снимок идентификаторов карт.
 *
 * `id` карты — неизменяемый ключ: он лежит в колодах игроков (localStorage) и в
 * кодах колод. Каталог правится по арту (docs/CATALOG_REVIEW.md, R2), при этом
 * меняются имена, цифры и земли — но НЕ id. Снимок `individual_cards/card-ids.json`
 * фиксирует текущий набор id, а тест `src/data/catalog.test.js` падает, если
 * набор изменился: значит карту переименовали вместе с id (сломает колоды) или
 * карта исчезла/появилась без записи в журнал.
 *
 * Запуск:
 *   node scripts/sync-card-ids.mjs          # показать расхождения с каталогом
 *   node scripts/sync-card-ids.mjs --write  # обновить снимок (осознанное решение)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const CARDS = 'individual_cards/cards.json'
const SNAPSHOT = 'individual_cards/card-ids.json'

const cards = JSON.parse(readFileSync(CARDS, 'utf8'))
const ids = cards.map((card) => card.id)
const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i)
const snapshot = existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, 'utf8')) : { ids: [] }

const added = ids.filter((id) => !snapshot.ids.includes(id))
const removed = snapshot.ids.filter((id) => !ids.includes(id))

console.log(`Каталог: ${ids.length} карт, снимок: ${snapshot.ids.length}`)
if (duplicates.length) console.error(`Дубли id в каталоге: ${[...new Set(duplicates)].join(', ')}`)
if (added.length) console.log(`Новые id (${added.length}): ${added.slice(0, 10).join(', ')}${added.length > 10 ? ' …' : ''}`)
if (removed.length) console.log(`Пропали id (${removed.length}): ${removed.slice(0, 10).join(', ')}${removed.length > 10 ? ' …' : ''}`)
if (!added.length && !removed.length && !duplicates.length) console.log('Расхождений нет.')

if (process.argv.includes('--write')) {
  writeFileSync(SNAPSHOT, `${JSON.stringify({ ids: [...ids].sort() }, null, 2)}\n`, 'utf8')
  console.log(`Записано: ${SNAPSHOT}`)
} else if (added.length || removed.length) {
  console.log('Если расхождение осознанное — запусти с --write и объясни в журнале.')
  process.exitCode = 1
}
