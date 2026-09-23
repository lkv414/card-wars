import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const root = process.cwd()
const report = JSON.parse(fs.readFileSync(path.join(root, 'individual_cards/duplicate-report.json'), 'utf8'))
const outDir = path.join(root, 'individual_cards/duplicate-review')
fs.mkdirSync(outDir, { recursive: true })
const groups = report.imageDuplicateGroups
const perSheet = 6
const cellW = 220
const cellH = 330
for (let start = 0; start < groups.length; start += perSheet) {
  const slice = groups.slice(start, start + perSheet)
  const composites = []
  for (let i = 0; i < slice.length; i++) {
    const group = slice[i]
    const y = i * cellH
    for (let j = 0; j < group.length; j++) {
      const item = group[j]
      const file = path.join(root, 'individual_cards', item.image_url)
      const buf = await sharp(file).resize(200, 280).jpeg({ quality: 85 }).toBuffer()
      composites.push({ input: buf, left: 5 + j * 210, top: y + 22 })
      const label = `${start + i + 1}.${j + 1} ${path.basename(item.image_url)}`
      const svg = Buffer.from(`<svg width="205" height="20"><rect width="205" height="20" fill="white"/><text x="2" y="15" font-size="12" font-family="Arial">${label}</text></svg>`)
      composites.push({ input: svg, left: 5 + j * 210, top: y })
    }
  }
  await sharp({ create: { width: cellW * 2, height: cellH * slice.length, channels: 3, background: '#dddddd' } })
    .composite(composites)
    .jpeg({ quality: 90 })
    .toFile(path.join(outDir, `contact-${String(start / perSheet + 1).padStart(2, '0')}.jpg`))
}
console.log(`sheets=${Math.ceil(groups.length / perSheet)}`)
