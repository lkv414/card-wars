import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const exportDir = path.join(root, 'individual_cards')
const report = JSON.parse(fs.readFileSync(path.join(exportDir, 'duplicate-report.json'), 'utf8'))
const decisions = []
for (const file of fs.readdirSync(exportDir).filter((f) => /^decisions-.*\.json$/i.test(f))) {
  const value = JSON.parse(fs.readFileSync(path.join(exportDir, file), 'utf8'))
  if (Array.isArray(value)) decisions.push(...value)
}
const byGroup = new Map(decisions.map((d) => [Number(d.group), d]))
const cards = JSON.parse(fs.readFileSync(path.join(exportDir, 'cards.json'), 'utf8'))
const cardByImage = new Map(cards.map((card) => [card.image_url.replace(/^images\//, ''), card]))
const removeImages = new Set()
const duplicateFiles = new Set(report.imageDuplicateGroups.flatMap((group) => group.map((item) => item.image_url.replace(/^images\//, ''))))
const kept = cards.filter((card) => !duplicateFiles.has(card.image_url.replace(/^images\//, '')))

for (const [index, group] of report.imageDuplicateGroups.entries()) {
  const decision = byGroup.get(index + 1)
  const groupFiles = group.map((item) => item.image_url.replace(/^images\//, ''))
  if (!decision) {
    console.warn(`No decision for group ${index + 1}; keeping first record`)
    const first = cardByImage.get(groupFiles[0])
    if (first) kept.push(first)
    for (const file of groupFiles.slice(1)) removeImages.add(file)
    continue
  }
  const canonicalFile = String(decision.canonical_filename || groupFiles[0]).replace(/^images\//, '')
  const canonical = cardByImage.get(canonicalFile)
  if (!canonical) throw new Error(`Canonical image not found: ${canonicalFile}`)
  const merged = { ...canonical }
  for (const field of ['name', 'card_type', 'cost', 'attack', 'health', 'land_type', 'is_rainbow', 'has_flip', 'flip_description', 'description', 'mechanics']) {
    if (decision[field] !== undefined) merged[field] = decision[field]
  }
  kept.push(merged)
  for (const file of groupFiles) if (file !== canonicalFile) removeImages.add(file)
}

const keptImages = new Set(kept.map((card) => card.image_url.replace(/^images\//, '')))
if (kept.length !== new Set(kept.map((card) => card.image_url)).size) throw new Error('Duplicate image remains in cards.json')
for (const file of removeImages) {
  const full = path.join(exportDir, 'images', file)
  if (fs.existsSync(full)) fs.rmSync(full)
  if (!keptImages.has(file)) continue
}
fs.writeFileSync(path.join(exportDir, 'cards.json'), `${JSON.stringify(kept, null, 2)}\n`, 'utf8')
console.log(`cards=${kept.length}`)
console.log(`removed_images=${removeImages.size}`)
console.log(`groups=${report.imageDuplicateGroups.length}`)
console.log(`decisions=${byGroup.size}`)
