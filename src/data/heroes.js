/**
 * heroes.js — герои из локального JSON (`src/data/heroes.json`).
 *
 * Этап 5 плана в v2: раньше герои приходили из Supabase (`heroes_v`), теперь
 * лежат в репозитории рядом с клиентским кодом. Worker героев не читает.
 */
import heroesJson from './heroes.json' with { type: 'json' }

/** @type {ReadonlyArray<Record<string, unknown>>} */
export const HEROES = heroesJson
