/**
 * textureCache — LRU-кэш текстур с ограниченным бюджетом GPU-памяти.
 *
 * Что было не так (PERFORMANCE_AUDIT_3D.md, 🔴 Критично K4):
 *   - `Map` без лимита и без dispose → VRAM росла монотонно всю сессию;
 *     1923 исходника карт по 797×1104 дают ~4.7 МБ на текстуру с мипмапами,
 *     то есть за длинную партию легко набиралось 150–190 МБ → webglcontextlost.
 *   - `loader.setCrossOrigin()` вызывался ПОСЛЕ `loader.load()` — первая
 *     загрузка каждого URL шла с прошлым значением crossOrigin.
 *   - Текстуры не ресайзились: на слабом GPU 797×1104 для карточки, которая
 *     на экране занимает ~240×340 px, — чистые потери памяти.
 *
 * Что делаем:
 *   - LRU с двумя ограничениями: по числу текстур и по суммарным байтам;
 *   - `dispose()` при вытеснении (skills/threejs-textures: «Disposal: dispose()
 *     textures when replacing to free GPU memory»);
 *   - ресайз до `maxTextureSize` на этапе загрузки — экономит и VRAM, и
 *     пропускную способность при upload;
 *   - crossOrigin выставляется один раз при создании лоадера.
 */
import { TextureLoader, SRGBColorSpace, LinearFilter, LinearMipmapLinearFilter } from 'three'

const PLACEHOLDER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII='

const loader = new TextureLoader()
// ВАЖНО: до первого load(), а не после — иначе первый запрос уйдёт
// с дефолтным crossOrigin.
loader.setCrossOrigin('anonymous')

const DEFAULT_MAX_TEXTURES = 64
const DEFAULT_MAX_BYTES = 96 * 1024 * 1024

// Map сохраняет порядок вставки → этого достаточно для LRU:
// при обращении переставляем ключ в конец, при вытеснении берём из начала.
/** @type {Map<string, {promise: Promise<any>, texture: any|null, bytes: number}>} */
const cache = new Map()

let maxTextures = DEFAULT_MAX_TEXTURES
let maxBytes = DEFAULT_MAX_BYTES

/**
 * @param {{maxTextures?: number, maxBytes?: number}} [options]
 */
export function setTextureBudget({ maxTextures: mt, maxBytes: mb } = {}) {
  if (typeof mt === 'number' && mt > 0) maxTextures = mt
  if (typeof mb === 'number' && mb > 0) maxBytes = mb
  evictIfNeeded()
}

export function getTextureBudget() {
  return { maxTextures, maxBytes, count: cache.size }
}

/** Приблизительная оценка VRAM: RGBA + полная пирамида мипмапов (~×1.33). */
function estimateBytes(width, height) {
  if (!width || !height) return 0
  return Math.round(width * height * 4 * 1.33)
}

function currentBytes() {
  let total = 0
  for (const entry of cache.values()) total += entry.bytes
  return total
}

function disposeEntry(entry) {
  if (entry?.texture) {
    entry.texture.dispose?.()
    entry.texture = null
  }
}

/**
 * Вытесняем самые давно не использованные записи, пока не уложимся в бюджет.
 * Незавершённые (pending) записи не трогаем — иначе await-вший их компонент
 * получит уже освобождённую текстуру и отрисует мусор.
 */
function evictIfNeeded() {
  let bytes = currentBytes()
  for (const [key, entry] of cache) {
    if (cache.size <= maxTextures && bytes <= maxBytes) break
    if (!entry.texture) continue // pending — пропускаем
    bytes -= entry.bytes
    disposeEntry(entry)
    cache.delete(key)
  }
}

/**
 * Ужать `image` до `maxSize` по большой стороне.
 * Возвращает canvas (если ресайз нужен) или исходный image.
 */
function downscaleImage(image, maxSize) {
  const w = image.width || 0
  const h = image.height || 0
  if (!maxSize || !w || !h) return image
  const longest = Math.max(w, h)
  if (longest <= maxSize) return image

  const scale = maxSize / longest
  const tw = Math.max(1, Math.round(w * scale))
  const th = Math.max(1, Math.round(h * scale))

  const canvas = document.createElement('canvas')
  canvas.width = tw
  canvas.height = th
  const ctx = canvas.getContext('2d')
  if (!ctx) return image
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, tw, th)
  return canvas
}

/**
 * Загрузить текстуру с кэшированием.
 *
 * @param {string|null|undefined} url
 * @param {{ maxTextureSize?: number }} [options]
 *   maxTextureSize — ограничение по большой стороне (пиксели).
 * @returns {Promise<import('three').Texture>}
 */
export function loadCachedTexture(url, options = {}) {
  const key = url || PLACEHOLDER
  const hit = cache.get(key)
  if (hit) {
    // LRU: переставляем в конец
    cache.delete(key)
    cache.set(key, hit)
    return hit.promise
  }

  const maxTextureSize = options.maxTextureSize ?? 0

  const entry = { promise: null, texture: null, bytes: 0 }
  const promise = new Promise((resolve, reject) => {
    loader.load(
      key,
      (texture) => {
        // Ресайз ДО первой загрузки в GPU — экономия VRAM и bandwidth.
        if (maxTextureSize && texture.image) {
          texture.image = downscaleImage(texture.image, maxTextureSize)
        }
        texture.colorSpace = SRGBColorSpace
        texture.magFilter = LinearFilter
        texture.minFilter = LinearMipmapLinearFilter
        texture.generateMipmaps = true
        texture.anisotropy = 1
        texture.needsUpdate = true

        entry.texture = texture
        entry.bytes = estimateBytes(texture.image?.width, texture.image?.height)
        evictIfNeeded()
        resolve(texture)
      },
      undefined,
      reject,
    )
  })

  entry.promise = promise
  cache.set(key, entry)
  // Неудавшиеся загрузки не должны занимать место в кэше.
  promise.catch(() => {
    if (cache.get(key) === entry) cache.delete(key)
  })
  evictIfNeeded()
  return promise
}

export function clearTextureCache() {
  for (const entry of cache.values()) disposeEntry(entry)
  cache.clear()
}

/** Только для тестов. */
export function getTextureCacheSize() {
  return cache.size
}

export function getPlaceholderTextureUrl() {
  return PLACEHOLDER
}
