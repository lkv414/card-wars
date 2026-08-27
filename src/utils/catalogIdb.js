/**
 * Tiny IndexedDB wrapper for caching the read-only game catalog.
 *
 * Used by `useCatalog` to avoid re-downloading the full cards/lands JSON on
 * every page load. Schema is intentionally trivial — one object store per
 * key, no versioning, no migrations. If the schema needs to change, bump
 * the DB name below.
 *
 * Falls back to `null` if IndexedDB is unavailable (e.g. SSR, private mode,
 * sandboxed iframe). The caller decides what to do — typically fall back
 * to a direct HTTP fetch.
 */

const DB_NAME = 'cw-catalog'
const STORE_NAME = 'kv'
const DB_VERSION = 1

let openingPromise = null

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (openingPromise) return openingPromise

  openingPromise = new Promise((resolve) => {
    let req
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    req.onupgradeneeded = () => {
      try {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
      } catch {
        /* ignore — fall through to error handler */
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })

  return openingPromise
}

function tx(db, mode, fn) {
  return new Promise((resolve) => {
    if (!db) {
      resolve(null)
      return
    }
    let transaction
    let result
    try {
      transaction = db.transaction(STORE_NAME, mode)
      const store = transaction.objectStore(STORE_NAME)
      result = fn(store)
    } catch {
      resolve(null)
      return
    }
    transaction.oncomplete = () => resolve(result?.result ?? null)
    transaction.onerror = () => resolve(null)
    transaction.onabort = () => resolve(null)
  })
}

/** Read a cached value. Returns the stored value or `null`. */
export async function idbGet(key) {
  const db = await openDb()
  if (!db) return null
  const result = await tx(db, 'readonly', (store) => store.get(key))
  return result ?? null
}

/** Write a value to the cache. Silent no-op if IndexedDB is unavailable. */
export async function idbSet(key, value) {
  const db = await openDb()
  if (!db) return
  await tx(db, 'readwrite', (store) => store.put(value, key))
}

/** Drop a cached value. */
export async function idbDelete(key) {
  const db = await openDb()
  if (!db) return
  await tx(db, 'readwrite', (store) => store.delete(key))
}