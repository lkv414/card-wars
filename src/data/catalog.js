/**
 * catalog.js — единственный источник каталога (карты + земли) для клиента.
 *
 * Этап 5 плана v2: каталог больше не приходит из Supabase и не кэшируется в
 * IndexedDB — он собирается в бандл из `individual_cards/cards.json`
 * (тот же файл импортирует Worker, см. `workers/src/catalog.ts`).
 *
 * Земли не лежат отдельным файлом: типы земель — это справочник в коде
 * (`src/constants/landColors.js`, LAND_DEFS), и `id` земли совпадает с
 * `land_type`. Поэтому зона игры ссылается на землю тем же значением, что
 * и её тип (`corn`, `ice`, `good`, `swamp`, `sand`, `blue`).
 */
import cardsJson from '../../individual_cards/cards.json' with { type: 'json' }
import { LAND_DEFS, FALLBACK_LAND_ID } from '../constants/landColors.js'

/** Полный список карт каталога (504 записи). */
export const CARDS = cardsJson

/**
 * @typedef {object} CatalogLand
 * @property {string} id
 * @property {string} land_type
 * @property {string} name
 * @property {string|null} description
 * @property {string|null} image_url
 */

/**
 * Земли — по строке на каждый канонический тип, кроме служебного `any`
 * (он не выбирается в разметке земель). Арт земель не задан.
 * @type {ReadonlyArray<Readonly<CatalogLand>>}
 */
export const LANDS = Object.freeze(
  Object.values(LAND_DEFS)
    .filter((def) => def.id !== FALLBACK_LAND_ID)
    .map((def) =>
      Object.freeze({
        id: def.id,
        land_type: def.id,
        name: def.label,
        description: null,
        image_url: null,
      }),
    ),
)

/** Ключи каталога → строки, как раньше возвращал `useCatalog`. */
export const CATALOG = Object.freeze({ cards: CARDS, lands: LANDS })
