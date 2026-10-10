/**
 * cardCompositeTexture — собирает art + статы (cost/atk/hp/land/flip) в одну
 * CanvasTexture, чтобы избавиться от troika <Text> и лишних <mesh>-индикаторов
 * на каждой карте.
 *
 * Архитектура:
 *   - Canvas 512×731 (соотношение 0.7:1.0 карты).
 *   - Сначала art (cover), потом overlays (cost, attack, defense, land, flip).
 *   - Результат оборачивается в THREE.CanvasTexture с SRGBColorSpace и линейной
 *     фильтрацией.
 *   - LRU-кэш по `${card.id}:${cost}:${attack}:${health}:${landType}:${flipped}` —
 *     уникальная текстура на каждую (карта, статы) комбинацию.
 *
 * Эффект: −58 troika <Text>, −3-4 mesh-индикатора на карту, −SDF-атласы (~20–60 МБ VRAM),
 * 1 draw call вместо ~8 на лицо карты.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { SRGBColorSpace, LinearFilter, LinearMipmapLinearFilter } from 'three'

import { resolveCardImageUrl } from './enrichGameCards.js'

const TEXTURE_WIDTH = 512
const TEXTURE_HEIGHT_ADJUSTED = Math.round(TEXTURE_WIDTH * (1.0 / 0.7))

const MAX_CACHE = 64
const cache = new Map()

function disposeEntry(entry) {
  entry?.texture?.dispose?.()
  if (entry?.canvas) {
    entry.canvas.width = 0
    entry.canvas.height = 0
  }
}

function evictIfNeeded() {
  while (cache.size > MAX_CACHE) {
    const oldestKey = cache.keys().next().value
    const entry = cache.get(oldestKey)
    disposeEntry(entry)
    cache.delete(oldestKey)
  }
}

function buildSignature({ id, cost, attack, health, landType, flipped }) {
  return [
    id ?? 'unknown',
    cost ?? '',
    attack ?? '',
    health ?? '',
    landType ?? '',
    flipped ? '1' : '0',
  ].join('|')
}

const COLORS = {
  costBg: '#FF9800',
  costText: '#000',
  attackBg: '#F44336',
  attackText: '#fff',
  defenseBg: '#4CAF50',
  defenseText: '#fff',
  flipBg: '#FFC107',
  flipText: '#000',
  landBg: 'rgba(255,255,255,0.85)',
  landText: '#222',
  placeholder: '#5d4e8a',
}

// Аббревиатуры земель берутся из единственного справочника (аудит §2.3:
// раньше здесь была третья копия списка, расходившаяся с landColors/game).
import { getLandDef } from '../constants/landColors.js'

function drawArt(ctx, artImage) {
  ctx.fillStyle = COLORS.placeholder
  ctx.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT_ADJUSTED)

  if (!artImage) return

  const ar = artImage.width / artImage.height
  const target = TEXTURE_WIDTH / TEXTURE_HEIGHT_ADJUSTED
  let dw, dh, dx, dy
  if (ar > target) {
    dh = TEXTURE_HEIGHT_ADJUSTED
    dw = dh * ar
    dx = (TEXTURE_WIDTH - dw) / 2
    dy = 0
  } else {
    dw = TEXTURE_WIDTH
    dh = dw / ar
    dx = 0
    dy = (TEXTURE_HEIGHT_ADJUSTED - dh) / 2
  }
  ctx.drawImage(artImage, dx, dy, dw, dh)
}

function drawBadge(ctx, x, y, w, h, bg, text, opts = {}) {
  const radius = Math.min(w, h) * 0.2
  ctx.fillStyle = bg
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius)
  } else {
    ctx.rect(x, y, w, h)
  }
  ctx.fill()

  ctx.fillStyle = opts.color || '#000'
  ctx.font = `${opts.fontSize || h * 0.65}px ${opts.font || 'sans-serif'}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + w / 2, y + h / 2 + 2)
}

function drawStats(ctx, stats) {
  const padding = TEXTURE_WIDTH * 0.045
  const badgeSize = TEXTURE_WIDTH * 0.18

  if (stats.cost != null) {
    drawBadge(ctx, padding, padding, badgeSize, badgeSize, COLORS.costBg,
      String(stats.cost), { color: COLORS.costText, fontSize: badgeSize * 0.7 })
  }

  if (stats.attack != null) {
    drawBadge(ctx, padding, TEXTURE_HEIGHT_ADJUSTED - padding - badgeSize,
      badgeSize, badgeSize, COLORS.attackBg, String(stats.attack),
      { color: COLORS.attackText, fontSize: badgeSize * 0.7 })
  }

  if (stats.health != null) {
    drawBadge(ctx, TEXTURE_WIDTH - padding - badgeSize,
      TEXTURE_HEIGHT_ADJUSTED - padding - badgeSize, badgeSize, badgeSize,
      COLORS.defenseBg, String(stats.health),
      { color: COLORS.defenseText, fontSize: badgeSize * 0.7 })
  }

  // Канонический тип уже нормализован вызывающим кодом; unknown отсеивается.
  if (stats.landType && stats.landType !== 'any') {
    const badge = getLandDef(stats.landType).badge
    if (badge && badge !== '*') {
      drawBadge(ctx, TEXTURE_WIDTH / 2 - badgeSize / 2, padding,
        badgeSize, badgeSize * 0.7, COLORS.landBg,
        badge,
        { color: COLORS.landText, fontSize: badgeSize * 0.45 })
    }
  }

  if (stats.canFlip) {
    drawBadge(ctx, TEXTURE_WIDTH - padding - badgeSize * 0.6, padding,
      badgeSize * 0.6, badgeSize * 0.6, COLORS.flipBg, '↻',
      { color: COLORS.flipText, fontSize: badgeSize * 0.5 })
  }
}

function createCanvas() {
  const canvas = document.createElement('canvas')
  canvas.width = TEXTURE_WIDTH
  canvas.height = TEXTURE_HEIGHT_ADJUSTED
  return canvas
}

function createTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 1
  texture.needsUpdate = true
  return texture
}

function getOrCreateEntry(signature) {
  let entry = cache.get(signature)
  if (entry) {
    cache.delete(signature)
    cache.set(signature, entry)
    return entry
  }
  const canvas = createCanvas()
  const texture = createTexture(canvas)
  entry = { signature, canvas, texture, artImage: null, artUrl: null }
  cache.set(signature, entry)
  evictIfNeeded()
  return entry
}

function extractStats(card, showStats, showFlipOption) {
  if (!card) return { cost: null, attack: null, health: null, landType: null, canFlip: false }
  return {
    cost: showStats ? card.cost ?? null : null,
    attack: showStats ? card.attack ?? null : null,
    health: showStats ? (card.health ?? card.defense ?? null) : null,
    landType: showStats ? card.land_type ?? null : null,
    canFlip: showFlipOption,
  }
}

/**
 * Хук: возвращает CanvasTexture, объединяющую art карты и overlays статов.
 * Entry — модульный кэш, мутируется эффектами для перерисовки canvas.
 * Сам hook возвращает ref с актуальной текстурой, обновляемой при изменении signature.
 */
export function useCardCompositeTexture(card, options = {}) {
  const showStats = options.showStats !== false
  const showFlipOption = options.showFlipOption === true

  const cardId = card?.id ?? card?.instanceId ?? null
  const signature = useMemo(() => {
    return buildSignature({
      id: cardId,
      cost: showStats ? card?.cost : null,
      attack: showStats ? card?.attack : null,
      health: showStats ? (card?.health ?? card?.defense) : null,
      landType: showStats ? card?.land_type : null,
      flipped: card?.flipped,
    })
  }, [
    cardId,
    showStats,
    card?.cost,
    card?.attack,
    card?.health,
    card?.defense,
    card?.land_type,
    card?.flipped,
  ])

  // Entry — модульный кэш, мутируемый эффектами (texture.needsUpdate, artImage).
  // useMemo гарантирует стабильную ссылку, пока signature не меняется.
  const entry = useMemo(() => getOrCreateEntry(signature), [signature])

  // Art и статы — отдельные useMemo, чтобы эффекты зависели от примитивов/объектов.
  const artUrl = resolveCardImageUrl(card)
  const stats = useMemo(
    () => extractStats(card, showStats, showFlipOption),
    [card, showStats, showFlipOption],
  )

  // Module-level mutation helpers — вынесены из компонента, чтобы react-hooks/immutability
// не считал их модификацией локальных переменных.
function redrawCanvas(entry, stats) {
  const ctx = entry.canvas.getContext('2d')
  if (entry.artImage) {
    drawArt(ctx, entry.artImage)
  } else {
    drawArt(ctx, null)
  }
  drawStats(ctx, stats)
  entry.texture.needsUpdate = true
}

function setArtImage(entry, img, artUrl, stats) {
  entry.artImage = img
  entry.artUrl = artUrl
  const ctx = entry.canvas.getContext('2d')
  drawArt(ctx, img)
  drawStats(ctx, stats)
  entry.texture.needsUpdate = true
}

function clearArtImage(entry) {
  entry.artImage = null
  entry.artUrl = null
}

// Перерисовываем overlays при изменении signature/stats.
useEffect(() => {
  redrawCanvas(entry, stats)
}, [entry, stats])

// Загружаем art: при смене URL или первом рендере.
useEffect(() => {
  if (!artUrl) {
    clearArtImage(entry)
    return
  }
  if (entry.artImage && entry.artUrl === artUrl) return

  let cancelled = false
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    if (cancelled) return
    setArtImage(entry, img, artUrl, stats)
  }
  img.onerror = () => {
    // Не падаем — placeholder остаётся.
  }
  img.src = artUrl
  return () => {
    cancelled = true
  }
}, [artUrl, entry, stats])

  return entry.texture
}

/** Только для тестов: сбросить кэш. */
export function __resetCardCompositeCache() {
  for (const entry of cache.values()) disposeEntry(entry)
  cache.clear()
}

export const CARD_COMPOSITE_DIMENSIONS = Object.freeze({
  width: TEXTURE_WIDTH,
  height: TEXTURE_HEIGHT_ADJUSTED,
})