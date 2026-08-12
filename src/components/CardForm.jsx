import { useState, useEffect, useRef, useCallback } from 'react'
import { Modal } from './Shared/Modal'
import { CardArtEditor } from './admin/CardArtEditor'
import { CARD_TYPES, LAND_TYPES } from '../constants/game'

const emptyCard = {
  card_number: '',
  name: '',
  card_type: 'creature',
  cost: 1,
  attack: 0,
  health: 1,
  land_type: 'corn',
  is_rainbow: false,
  has_flip: false,
  flip_description: '',
  description: '',
  image_url: '',
  mechanics: '[]',
  rarity: '',
  hero: '',
  source: '',
  notes: '',
}

export function CardForm({
  card,
  onClose,
  onSave,
  isNew,
  similarCards,
  setSimilarCards,
  onDelete,
  onFindSimilarCards,
}) {
  const [form, setForm] = useState(
    card ? { ...card, mechanics: JSON.stringify(card.mechanics ?? [], null, 2) } : emptyCard
  )
  const [jsonError, setJsonError] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const submitRef = useRef(() => {})

  useEffect(() => {
    setImageFailed(false)
  }, [form.image_url])

  const imageWarning =
    form.image_url && !/^https?:\/\//.test(form.image_url)
      ? 'URL должен начинаться с http:// или https://'
      : ''

  const set = (key, value) =>
    setForm((prev) => ({
      ...prev,
      [key]: value,
      ...(key === 'cost' && Number(value) === 0 ? { is_rainbow: true, land_type: 'any' } : {}),
      ...(key === 'is_rainbow' && value ? { land_type: 'any' } : {}),
    }))

  const submit = useCallback(async (force = false) => {
    let mechanics
    try {
      mechanics = JSON.parse(form.mechanics || '[]')
      setJsonError('')
    } catch (e) {
      setJsonError(e.message)
      return
    }
    if (!form.card_number || !form.name.trim() || form.cost === '') return

    if (isNew && !force) {
      const data = await onFindSimilarCards?.(form.name, form.description)
      if (data?.length) {
        setSimilarCards(data)
        return
      }
    }

    onSave({
      ...form,
      card_number: Number(form.card_number),
      cost: Number(form.cost),
      attack: Number(form.attack || 0),
      health: Number(form.health || 0),
      mechanics,
    })
  }, [form, isNew, onFindSimilarCards, onSave, setSimilarCards])

  const confirmDelete = async () => {
    if (onDelete) {
      await onDelete(card)
      onClose()
    }
  }

  useEffect(() => {
    submitRef.current = submit
  }, [submit])

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        submitRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (similarCards.length > 0 && !showDeleteConfirm) {
    return (
      <Modal onClose={onClose} stacked>
        <h2>⚠️ Похожие карты найдены</h2>
        <p>Карта с похожим названием или описанием уже существует:</p>
        <div style={{ display: 'grid', gap: '12px', margin: '16px 0' }}>
          {similarCards.map((similar) => (
            <div key={similar.id} style={{ padding: '12px', border: '1px solid #e0d2bd', borderRadius: '8px' }}>
              <strong>{similar.name}</strong> (#{similar.card_number})
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button onClick={() => setSimilarCards([])}>← Вернуться</button>
          <button className="primary" onClick={() => submit(true)}>
            ✅ Всё равно добавить
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <>
      <Modal onClose={onClose} stacked className="modal--card-form">
        <h2>{isNew ? '➕ Новая карта' : '✏️ Редактировать карту'}</h2>

        <div className="card-form-layout">
          <aside className="card-form-preview" aria-label="Превью карты">
            <div className="card-form-preview-art">
              {form.image_url && !imageFailed ? (
                <img
                  src={form.image_url}
                  alt={form.name || 'Превью карты'}
                  className="card-form-preview-img"
                  onError={() => setImageFailed(true)}
                />
              ) : (
                <div className="card-form-preview-fallback" aria-hidden="true">
                  <span>{LAND_TYPES[form.land_type]?.icon || '🃏'}</span>
                  <p>{form.image_url ? 'Не удалось загрузить art' : 'Нет изображения'}</p>
                </div>
              )}
              <span className="card-form-preview-num">#{form.card_number || '?'}</span>
            </div>

            <div className="card-form-preview-meta">
              <h3 className="card-form-preview-name">{form.name?.trim() || '— без названия —'}</h3>
              <span className="card-form-preview-type">
                {CARD_TYPES[form.card_type] || form.card_type || '?'}
              </span>

              <dl className="card-form-preview-stats">
                <div>
                  <dt>💧</dt>
                  <dd>{form.cost !== '' ? form.cost : '—'}</dd>
                </div>
                {form.card_type === 'creature' && (
                  <>
                    <div>
                      <dt>⚔️</dt>
                      <dd>{form.attack !== '' && form.attack != null ? form.attack : '—'}</dd>
                    </div>
                    <div>
                      <dt>❤️</dt>
                      <dd>{form.health !== '' && form.health != null ? form.health : '—'}</dd>
                    </div>
                  </>
                )}
                <div>
                  <dt>{LAND_TYPES[form.land_type]?.icon || '🌍'}</dt>
                  <dd>{LAND_TYPES[form.land_type]?.shortLabel || form.land_type || '—'}</dd>
                </div>
              </dl>

              <div className="card-form-preview-flags">
                {form.is_rainbow && <span className="admin-flag admin-flag--rainbow">🌈 радуга</span>}
                {form.has_flip && <span className="admin-flag admin-flag--flip">Флюп</span>}
              </div>

              {form.description?.trim() && (
                <p className="card-form-preview-desc">{form.description}</p>
              )}
              {form.has_flip && form.flip_description?.trim() && (
                <p className="card-form-preview-flip">
                  <strong>Флюп:</strong> {form.flip_description}
                </p>
              )}
            </div>
          </aside>

          <div className="card-form-fields">
            <div className="form-grid">
              <label htmlFor="card-number">
                Номер карты
                <input
                  id="card-number"
                  type="number"
                  required
                  value={form.card_number}
                  onChange={(e) => set('card_number', e.target.value)}
                />
              </label>

              <label htmlFor="card-name">
                Название
                <input
                  id="card-name"
                  required
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                />
              </label>

              <label htmlFor="card-type">
                Тип карты
                <select id="card-type" value={form.card_type} onChange={(e) => set('card_type', e.target.value)}>
                  {Object.entries(CARD_TYPES).map(([v, l]) => (
                    <option value={v} key={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>

              <label htmlFor="card-cost">
                Стоимость
                <input
                  id="card-cost"
                  type="number"
                  required
                  value={form.cost}
                  onChange={(e) => set('cost', e.target.value)}
                />
              </label>

              {form.card_type === 'creature' && (
                <>
                  <label htmlFor="card-attack">
                    Атака
                    <input id="card-attack" type="number" value={form.attack} onChange={(e) => set('attack', e.target.value)} />
                  </label>
                  <label htmlFor="card-health">
                    Защита
                    <input id="card-health" type="number" value={form.health} onChange={(e) => set('health', e.target.value)} />
                  </label>
                </>
              )}

              <label htmlFor="land-type">
                Тип земель
                <select id="land-type" value={form.land_type} onChange={(e) => set('land_type', e.target.value)}>
                  {Object.entries(LAND_TYPES).map(([v, l]) => (
                    <option value={v} key={v}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={form.is_rainbow}
                  onChange={(e) => set('is_rainbow', e.target.checked)}
                />{' '}
                Радужная карта
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={form.has_flip}
                  onChange={(e) => set('has_flip', e.target.checked)}
                />{' '}
                Есть механика Флюп
              </label>

              {form.has_flip && (
                <label className="wide" htmlFor="flip-description">
                  Описание флюпа
                  <input id="flip-description" value={form.flip_description || ''} onChange={(e) => set('flip_description', e.target.value)} />
                </label>
              )}

              <label className="wide" htmlFor="card-description">
                Описание карты
                <textarea id="card-description" value={form.description} onChange={(e) => set('description', e.target.value)} />
              </label>

              <label htmlFor="card-image-url">
                URL картинки
                <input
                  id="card-image-url"
                  value={form.image_url || ''}
                  onChange={(e) => set('image_url', e.target.value)}
                  aria-invalid={Boolean(imageWarning)}
                  aria-describedby={imageWarning ? 'card-image-url-warning' : undefined}
                />
                {imageWarning && (
                  <small id="card-image-url-warning" style={{ color: '#c2410c' }} role="alert">
                    ⚠️ {imageWarning}
                  </small>
                )}
              </label>

              <label htmlFor="card-rarity">
                Редкость
                <select id="card-rarity" value={form.rarity || ''} onChange={(e) => set('rarity', e.target.value)}>
                  <option value="">—</option>
                  <option value="common">common</option>
                  <option value="uncommon">uncommon</option>
                  <option value="rare">rare</option>
                  <option value="promo">promo</option>
                </select>
              </label>

              <label htmlFor="card-hero">
                Герой
                <input id="card-hero" value={form.hero || ''} onChange={(e) => set('hero', e.target.value)} />
              </label>

              <label htmlFor="card-source">
                Источник
                <input id="card-source" value={form.source || ''} onChange={(e) => set('source', e.target.value)} />
              </label>

              <label className="wide" htmlFor="card-notes">
                Заметки
                <textarea id="card-notes" value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} />
              </label>

              <label className="wide" htmlFor="card-mechanics">
                Механики (JSON)
                <textarea
                  id="card-mechanics"
                  value={form.mechanics}
                  onChange={(e) => set('mechanics', e.target.value)}
                  style={{ fontFamily: 'ui-monospace, monospace' }}
                  aria-invalid={Boolean(jsonError)}
                  aria-describedby={jsonError ? 'card-mechanics-error' : undefined}
                />
                {jsonError && (
                  <small id="card-mechanics-error" style={{ color: '#c2410c' }} role="alert">
                    ❌ {jsonError}
                  </small>
                )}
              </label>

              {!isNew && card?.id && (
                <CardArtEditor
                  cardId={card.id}
                  onPrimaryChange={() => {
                    /* preview uses image_url; admin can copy primary URL manually */
                  }}
                />
              )}
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button onClick={onClose}>← Отмена</button>
          <button className="primary" onClick={() => submit()}>
            ✅ {isNew ? 'Создать карту' : 'Сохранить'}
          </button>
          {!isNew && (
            <button
              className="delete-btn"
              onClick={() => setShowDeleteConfirm(true)}
              title="Удалить эту карту"
            >
              🗑️ Удалить
            </button>
          )}
        </div>
      </Modal>

      {showDeleteConfirm && (
        <Modal onClose={() => setShowDeleteConfirm(false)} stacked>
          <h2>🗑️ Удалить карту?</h2>
          <p>Вы уверены, что хотите удалить карту "{card?.name}"?</p>
          <div className="modal-actions">
            <button onClick={() => setShowDeleteConfirm(false)}>← Отмена</button>
            <button className="delete-btn" onClick={confirmDelete}>
              ✅ Удалить
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
