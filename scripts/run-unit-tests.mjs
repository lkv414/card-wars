#!/usr/bin/env node
/**
 * run-unit-tests.mjs — единый раннер юнит-тестов `src/`.
 *
 * Зачем он нужен вместо голого `node --test` по маске:
 *
 *   1. `node --test` не умеет исключать файлы по маске, а смоук-тесты
 *      (*.smoke.test.js|.jsx) живут на vitest — им нужен jsdom и React.
 *      Под node --test .jsx вообще не грузится (ERR_UNKNOWN_FILE_EXTENSION).
 *
 *   2. `node --test` не резолвит extensionless ESM-импорты: модули с точкой
 *      перед слешем обязаны указывать расширение, иначе ERR_MODULE_NOT_FOUND.
 *      Vite это прощает, node — нет.
 *
 *   3. В репозитории сосуществуют два API: `node:test` (большинство файлов)
 *      и `vitest` (gameStore / stabilizeGameState / wsQueue). Запуск неподходящего
 *      раннера даёт «Vitest failed to access its internal state».
 *
 * Поэтому скрипт сам определяет API каждого файла по импорту и раскладывает
 * тесты по двум прогонам. Раньше всё это давало 7 упавших файлов в `npm test`.
 *
 * Смоук-тесты: `npm run test:smoke`.
 * Store-тесты:  `npm run test:store`.
 * Движок DO:   `npm run test:engine`.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SRC = join(ROOT, 'src')

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const candidates = walk(SRC).filter((f) => /\.test\.(js|jsx)$/.test(f))
// .jsx и *.smoke.test.* — только vitest (jsdom + React).
const vitestOnly = (f) => f.endsWith('.test.jsx') || f.includes('.smoke.test.')

const nodeTest = []
const vitestTest = []
for (const file of candidates) {
  if (vitestOnly(file)) continue
  const src = readFileSync(file, 'utf8')
  if (/from\s+['"]vitest['"]/.test(src)) vitestTest.push(file)
  else nodeTest.push(file)
}

const rel = (f) => relative(ROOT, f).split(sep).join('/')

if (nodeTest.length === 0 && vitestTest.length === 0) {
  console.error('Найдено 0 юнит-тестов — проверьте, что src не пуст.')
  process.exit(1)
}

console.log(
  `Юнит-тесты: ${candidates.length} всего | node:test — ${nodeTest.length} | vitest — ${vitestTest.length} | smoke (.jsx) — на npm run test:smoke\n`,
)

let failed = false

// ── 1. node:test ────────────────────────────────────────────────────────────
if (nodeTest.length > 0) {
  const res = spawnSync(process.execPath, ['--test', ...nodeTest.map(rel)], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  if (res.status !== 0) failed = true
}

// ── 2. vitest (файлы, импортирующие API vitest) ─────────────────────────────
if (vitestTest.length > 0) {
  // Конфиг кладём ВНУТРЬ node_modules: оттуда резолвится 'vitest/config',
  // тогда как из системного tmp это даёт MODULE_NOT_FOUND. Папка в .gitignore.
  const dir = join(ROOT, 'node_modules', '.cardwars-testtmp')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const configPath = join(dir, 'vitest.unit-vitestapi.config.js')
  writeFileSync(
    configPath,
    `import { defineConfig } from 'vitest/config'\n` +
      `export default defineConfig({\n` +
      `  test: {\n` +
      `    environment: 'jsdom',\n` +
      `    globals: true,\n` +
      `    include: ${JSON.stringify(vitestTest.map(rel))},\n` +
      `    css: true,\n` +
      `  },\n` +
      `})\n`,
    'utf8',
  )
  const res = spawnSync(
    process.execPath,
    [join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--config', configPath],
    { cwd: ROOT, stdio: 'inherit' },
  )
  rmSync(dir, { recursive: true, force: true })
  if (res.status !== 0) failed = true
}

process.exit(failed ? 1 : 0)