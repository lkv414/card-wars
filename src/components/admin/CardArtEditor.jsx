import { useState } from 'react'
import { useCardArt } from '../../hooks/useCardArt'

export function CardArtEditor({ cardId, onPrimaryChange }) {
  const { rows, loading, addArt, setPrimary, removeArt } = useCardArt(cardId)
  const [draftUrl, setDraftUrl] = useState('')
  const [draftVariant, setDraftVariant] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!cardId) return null

  const handleAdd = async () => {
    setBusy(true)
    setError('')
    const result = await addArt({
      source_url: draftUrl,
      variant: draftVariant.trim() || null,
      is_primary: rows.length === 0,
    })
    setBusy(false)
    if (!result.success) {
      setError(result.error || 'Не удалось добавить арт')
      return
    }
    setDraftUrl('')
    setDraftVariant('')
    onPrimaryChange?.()
  }

  const handleSetPrimary = async (artId) => {
    setBusy(true)
    const result = await setPrimary(artId)
    setBusy(false)
    if (result.success) onPrimaryChange?.()
  }

  return (
    <div className="card-art-editor wide">
      <h3 className="card-art-title">Арты карты ({rows.length})</h3>
      {loading && <p className="card-art-sub">Загрузка…</p>}
      {rows.length > 0 && (
        <ul className="card-art-list">
          {rows.map((row) => (
            <li key={row.id} className={row.is_primary ? 'card-art-row is-primary' : 'card-art-row'}>
              <img src={row.source_url} alt="" className="card-art-thumb" loading="lazy" />
              <div className="card-art-meta">
                <code className="card-art-url">{row.source_url}</code>
                {row.variant && <span className="card-art-variant">{row.variant}</span>}
                {row.is_primary && <span className="card-art-badge">primary</span>}
              </div>
              <div className="card-art-actions">
                {!row.is_primary && (
                  <button type="button" className="deck-link-btn" disabled={busy} onClick={() => handleSetPrimary(row.id)}>
                    Primary
                  </button>
                )}
                <button type="button" className="delete-btn" disabled={busy} onClick={() => removeArt(row.id)}>
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="card-art-add">
        <input
          placeholder="URL арта"
          value={draftUrl}
          onChange={(e) => setDraftUrl(e.target.value)}
          aria-label="URL арта"
        />
        <input
          placeholder="variant (опц.)"
          value={draftVariant}
          onChange={(e) => setDraftVariant(e.target.value)}
          aria-label="Вариант арта"
        />
        <button type="button" className="primary" disabled={busy || !draftUrl.trim()} onClick={handleAdd}>
          + Арт
        </button>
      </div>
      {error && <p className="card-art-error" role="alert">{error}</p>}
    </div>
  )
}
