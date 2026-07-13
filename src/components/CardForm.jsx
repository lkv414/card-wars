import { useState, useEffect } from 'react'
import { Modal } from './Shared/Modal'
import { ImageThumb } from './Shared/ImageThumb'
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
  const [imageWarning, setImageWarning] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const set = (key, value) =>
    setForm((prev) => ({
      ...prev,
      [key]: value,
      ...(key === 'cost' && Number(value) === 0 ? { is_rainbow: true, land_type: 'any' } : {}),
      ...(key === 'is_rainbow' && value ? { land_type: 'any' } : {}),
    }))

  const submit = async (force = false) => {
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
  }

  const confirmDelete = async () => {
    if (onDelete) {
      await onDelete(card)
      onClose()
    }
  }

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        submit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

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
    <Modal onClose={onClose} stacked>
      <h2>{isNew ? '➕ Новая карта' : '✏️ Редактировать карту'}</h2>
      <div className="form-grid">
        <label>
          Номер карты
          <input
            type="number"
            required
            value={form.card_number}
            onChange={(e) => set('card_number', e.target.value)}
          />
        </label>

        <label>
          Название
          <input
            required
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </label>

        <label>
          Тип карты
          <select value={form.card_type} onChange={(e) => set('card_type', e.target.value)}>
            {Object.entries(CARD_TYPES).map(([v, l]) => (
              <option value={v} key={v}>
                {l}
              </option>
            ))}
          </select>
        </label>

        <label>
          Стоимость
          <input
            type="number"
            required
            value={form.cost}
            onChange={(e) => set('cost', e.target.value)}
          />
        </label>

        {form.card_type === 'creature' && (
          <>
            <label>
              Атака
              <input type="number" value={form.attack} onChange={(e) => set('attack', e.target.value)} />
            </label>
            <label>
              Защита
              <input type="number" value={form.health} onChange={(e) => set('health', e.target.value)} />
            </label>
          </>
        )}

        <label>
          Тип земель
          <select value={form.land_type} onChange={(e) => set('land_type', e.target.value)}>
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
          <label className="wide">
            Описание флюпа
            <input value={form.flip_description || ''} onChange={(e) => set('flip_description', e.target.value)} />
          </label>
        )}

        <label className="wide">
          Описание карты
          <textarea value={form.description} onChange={(e) => set('description', e.target.value)} />
        </label>

        <label className="wide">
          URL картинки
          <input
            value={form.image_url || ''}
            onChange={(e) => {
              set('image_url', e.target.value)
              setImageWarning(
                e.target.value && !/^https?:\/\//.test(e.target.value)
                  ? 'URL должен начинаться с http:// или https://'
                  : ''
              )
            }}
          />
          {imageWarning && <small style={{ color: '#c2410c' }}>⚠️ {imageWarning}</small>}
        </label>

        {form.image_url && (
          <div className="wide preview">
            <ImageThumb src={form.image_url} size="medium" alt={form.name} />
            <div>
              <p>
                <strong>{form.name}</strong>
              </p>
              <p className="mono">{form.image_url}</p>
            </div>
          </div>
        )}

        <label className="wide">
          Механики (JSON)
          <textarea
            value={form.mechanics}
            onChange={(e) => set('mechanics', e.target.value)}
            style={{ fontFamily: 'ui-monospace, monospace' }}
          />
          {jsonError && <small style={{ color: '#c2410c' }}>❌ {jsonError}</small>}
        </label>
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
    </Modal>
  )
}
