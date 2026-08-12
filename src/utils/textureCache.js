import { TextureLoader } from 'three'

const loader = new TextureLoader()
const cache = new Map()
const PLACEHOLDER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII='

export function loadCachedTexture(url, options = {}) {
  const key = url || PLACEHOLDER
  if (cache.has(key)) return cache.get(key)

  const promise = new Promise((resolve, reject) => {
    loader.load(
      key,
      (texture) => {
        if (options.crossOrigin) texture.colorSpace = undefined
        resolve(texture)
      },
      undefined,
      reject
    )
  })
  loader.setCrossOrigin(options.crossOrigin ?? 'anonymous')
  cache.set(key, promise)
  promise.catch(() => cache.delete(key))
  return promise
}

export function clearTextureCache() {
  for (const entry of cache.values()) {
    entry.then?.((tex) => tex?.dispose?.())
  }
  cache.clear()
}

export function getPlaceholderTextureUrl() {
  return PLACEHOLDER
}
