#!/usr/bin/env node
/**
 * build-card-art.mjs — арт карт: PNG → WebP → `public/cards/`.
 *
 * Зачем:
 *   `individual_cards/cards.json` ссылается на `images/<file>.png`, но каталога
 *   с этой статикой нет (`public/` = favicon/icons/_redirects), поэтому арт карт
 *   в приложении не раздаётся и текстуры уходят в placeholder
 *   (`src/utils/textureCache.js`). Скрипт конвертирует 504 PNG в WebP и
 *   переписывает `image_url` на `cards/<name>.webp`.
 *
 * Поведение:
 *   - источник — `individual_cards/images/<stem>.<png|webp|jpg|jpeg>`;
 *   - выход — `public/cards/<stem>.webp` (q82, большая сторона ≤ 1024);
 *     `image_url` пишется абсолютным (`/cards/<stem>.webp`) — относительный путь
 *     ломается на deep-роутах SPA;
 *   - уже сконвертированные файлы пропускаются (если не `--force`);
 *   - `cards.json` перезаписывается 2-space JSON + перевод строки (как было).
 *
 * Запуск:
 *   node scripts/build-card-art.mjs [--force] [--quality=82] [--max=1024]
 *
 * Оригиналы PNG остаются в репо в `исходники/карты/` — `individual_cards/images/`
 * после конвертации можно удалять.
 */
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const CARDS_JSON = path.join(ROOT, 'individual_cards', 'cards.json')
const IMAGES_DIR = path.join(ROOT, 'individual_cards', 'images')
const OUT_DIR = path.join(ROOT, 'public', 'cards')

const args = new Set(process.argv.slice(2))
const force = args.has('--force')
const numArg = (name, fallback) => {
  const hit = [...args].find((a) => a.startsWith(`--${name}=`))
  return hit ? Number(hit.split('=')[1]) : fallback
}
const quality = numArg('quality', 82)
const maxSide = numArg('max', 1024)

const SOURCE_EXTS = ['png', 'webp', 'jpg', 'jpeg']

function findSource(imageUrl) {
  const stem = path.basename(imageUrl).replace(/\.[^.]+$/, '')
  for (const ext of SOURCE_EXTS) {
    const candidate = path.join(IMAGES_DIR, `${stem}.${ext}`)
    if (existsSync(candidate)) return candidate
  }
  return null
}

async function main() {
  const raw = await fs.readFile(CARDS_JSON, 'utf8')
  const cards = JSON.parse(raw)

  await fs.mkdir(OUT_DIR, { recursive: true })

  let converted = 0
  let skipped = 0
  let missing = 0
  let failed = 0
  let bytesIn = 0
  let bytesOut = 0
  const misses = []
  const failures = []
  let changed = false

  for (const card of cards) {
    const outUrl = `/cards/${path.basename(card.image_url).replace(/\.[^.]+$/, '')}.webp`
    const outFile = path.join(ROOT, 'public', outUrl)

    const src = findSource(card.image_url)
    if (!src) {
      missing += 1
      misses.push(`${card.id} (${card.image_url})`)
      continue
    }

    if (card.image_url !== outUrl) {
      card.image_url = outUrl
      changed = true
    }

    if (!force && existsSync(outFile)) {
      skipped += 1
      bytesOut += (await fs.stat(outFile)).size
      continue
    }

    try {
      const inStat = await fs.stat(src)
      await sharp(src)
        .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
        .webp({ quality })
        .toFile(outFile)
      const outStat = await fs.stat(outFile)
      bytesIn += inStat.size
      bytesOut += outStat.size
      converted += 1
    } catch (err) {
      failed += 1
      failures.push(`${card.id}: ${err.message}`)
    }
  }

  if (changed) {
    await fs.writeFile(CARDS_JSON, JSON.stringify(cards, null, 2) + '\n', 'utf8')
  }

  const mb = (b) => (b / 1024 / 1024).toFixed(1)
  console.log(`Арт карт → public/cards/ (webp q${quality}, max ${maxSide}px)`)
  console.log(`карт всего: ${cards.length}`)
  console.log(`сконвертировано: ${converted} | пропущено (уже есть): ${skipped}`)
  console.log(`нет исходника: ${missing} | ошибок: ${failed}`)
  console.log(`вход: ${mb(bytesIn)} МБ → выход: ${mb(bytesOut)} МБ`)
  if (misses.length) console.log(`нет исходников:\n  ${misses.join('\n  ')}`)
  if (failures.length) console.log(`ошибки:\n  ${failures.join('\n  ')}`)
  console.log(`cards.json ${changed ? 'обновлён' : 'без изменений'}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})