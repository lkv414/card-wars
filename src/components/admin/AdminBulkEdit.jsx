import { useState } from 'react'

export function AdminBulkEdit({ selectedIds, cards, onApply, onClear }) {
  const [landType, setLandType] = useState('')
  const [cost, setCost] = useState('')
  const [applying, setApplying] = useState(false)

  if (!selectedIds?.size) return null

  const apply = async () => {
    const patch = {}
    if (landType) patch.land_type = landType
    if (cost !== '') patch.cost = Number(cost)
    if (!Object.keys(patch).length) return

    setApplying(true)
    try {
      await onApply?.([...selectedIds], patch)
      onClear?.()
      setLandType('')
      setCost('')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="admin-bulk-bar">
      <span>Выбрано: {selectedIds.size}</span>
      <label>
        Земля
        <select value={landType} onChange={(e) => setLandType(e.target.value)}>
          <option value="">—</option>
          <option value="corn">corn</option>
          <option value="plains">plains</option>
          <option value="swamp">swamp</option>
          <option value="crystal">crystal</option>
          <option value="any">any</option>
        </select>
      </label>
      <label>
        💧
        <input type="number" min="0" max="9" value={cost} onChange={(e) => setCost(e.target.value)} />
      </label>
      <button type="button" className="primary" disabled={applying} onClick={apply}>
        Применить
      </button>
      <button type="button" className="deck-link-btn" onClick={onClear}>
        Снять выбор
      </button>
    </div>
  )
}
