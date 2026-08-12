import * as THREE from 'three'
import { getLandPalette } from '../../../constants/landColors'

const cache = new Map()

function drawLandPattern(ctx, size, landType, fill) {
  ctx.fillStyle = fill
  ctx.fillRect(0, 0, size, size)

  const accent = 'rgba(0, 0, 0, 0.12)'

  switch (landType) {
    case 'corn': {
      for (let y = 0; y < size; y += 16) {
        ctx.fillStyle = y % 32 === 0 ? 'rgba(255, 235, 59, 0.35)' : 'rgba(76, 175, 80, 0.25)'
        ctx.fillRect(0, y, size, 8)
      }
      break
    }
    case 'swamp': {
      ctx.fillStyle = '#3d4449'
      ctx.fillRect(0, 0, size, size)
      for (let i = 0; i < 18; i++) {
        const r = 4 + (i % 5)
        const x = (i * 37) % size
        const y = (i * 53) % size
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(120, 144, 156, 0.45)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(200, 220, 230, 0.25)'
        ctx.lineWidth = 1
        ctx.stroke()
      }
      break
    }
    case 'good': {
      for (let i = 0; i < 40; i++) {
        const x = (i * 29) % size
        const y = (i * 41) % size
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 182, 193, 0.55)' : 'rgba(244, 143, 177, 0.35)'
        ctx.beginPath()
        ctx.ellipse(x, y, 3, 5, (i * 0.7) % Math.PI, 0, Math.PI * 2)
        ctx.fill()
      }
      break
    }
    case 'blue': {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
      ctx.lineWidth = 2
      for (let y = 8; y < size; y += 14) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        for (let x = 0; x <= size; x += 8) {
          ctx.lineTo(x, y + Math.sin(x * 0.08) * 3)
        }
        ctx.stroke()
      }
      break
    }
    case 'sand': {
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = accent
        ctx.fillRect((i * 17) % size, (i * 23) % size, 2, 2)
      }
      break
    }
    case 'ice': {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
      ctx.lineWidth = 1.5
      for (let i = 0; i < 8; i++) {
        const cx = size / 2
        const cy = size / 2
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(cx + Math.cos(i) * size, cy + Math.sin(i) * size)
        ctx.stroke()
      }
      break
    }
    default: {
      ctx.fillStyle = accent
      for (let x = 0; x < size; x += 12) {
        for (let y = 0; y < size; y += 12) {
          if ((x + y) % 24 === 0) ctx.fillRect(x, y, 4, 4)
        }
      }
    }
  }
}

/** Процедурная текстура земли (Card Wars — разные паттерны по типу). */
export function getLandTexture(landType) {
  const key = landType || 'default'
  if (cache.has(key)) return cache.get(key)

  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const { fill } = getLandPalette(landType)
  drawLandPattern(ctx, size, landType, fill)

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(2, 2)
  texture.colorSpace = THREE.SRGBColorSpace
  cache.set(key, texture)
  return texture
}
