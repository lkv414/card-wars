import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CardForm } from './CardForm'
import { CardTile } from './Shared/CardTile'
import { ConfirmDialog } from './Shared/ConfirmDialog'
import { CARD_TYPES, LAND_TYPES } from '../constants/game'

export function AdminPanel({
  cards,
  toast,
  createCard,
  updateCard,
  deleteCard,
  findSimilarCards,
}) {
  const navigate = useNavigate()
  const [type, setType] = useState('all')
  const [land, setLand] = useState('all')
  const [editing, setEditing] = useState(null)
  const [similar, setSimilar] = useState([])
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const filtered = cards.filter(
    (card) => (type === 'all' || card.card_type === type) && (land === 'all' || card.land_type === land)
  )

  const saveCard = async (card) => {
    if (!card) return

    const { id, ...rest } = card
    const result = id ? await updateCard(id, rest) : await createCard(rest)

    if (!result?.success) {
      toast('error', result?.error || 'Не удалось сохранить карту')
      return
    }

    setEditing(null)
    setSimilar([])
    toast('success', id ? 'Карта обновлена' : 'Карта создана')
  }

  const requestDelete = (card) => {
    if (!card) return
    setPendingDelete(card)
  }

  const confirmDelete = async () => {
    const card = pendingDelete
    if (!card || deleting) return

    setDeleting(true)
    try {
      const result = await deleteCard(card.id)
      if (!result?.success) {
        toast('error', result?.error || 'Не удалось удалить карту')
        return
      }

      setPendingDelete(null)
      setEditing(null)
      setSimilar([])
      toast('success', 'Карта удалена')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <main className="admin">
      <div className="admin-top">
        <button type="button" onClick={() => navigate('/deck')}>
          ← К редактору колод
        </button>
        <h1>Панель админа: Управление картами</h1>
        <button type="button" className="primary" onClick={() => setEditing({ isNew: true })}>
          Добавить карту
        </button>

        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Фильтр по типу">
          <option value="all">Все</option>
          {Object.entries(CARD_TYPES).map(([v, l]) => (
            <option value={v} key={v}>
              {l}
            </option>
          ))}
        </select>

        <select value={land} onChange={(e) => setLand(e.target.value)} aria-label="Фильтр по земле">
          <option value="all">Все земли</option>
          {Object.entries(LAND_TYPES).map(([v, l]) => (
            <option value={v} key={v}>
              {l.label}
            </option>
          ))}
        </select>

        <b>Всего карт: {filtered.length}</b>
      </div>

      <div className="cards-grid">
        {filtered.map((card) => (
          <CardTile
            key={card.id}
            item={card}
            showControls={false}
            onClick={() => setEditing(card)}
          />
        ))}
      </div>

      {editing && (
        <CardForm
          card={editing.isNew ? null : editing}
          isNew={editing.isNew}
          onClose={() => {
            setEditing(null)
            setSimilar([])
          }}
          onSave={saveCard}
          similarCards={similar}
          setSimilarCards={setSimilar}
          onDelete={requestDelete}
          onFindSimilarCards={findSimilarCards}
        />
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Удалить карту?"
        message={
          pendingDelete
            ? `«${pendingDelete.name}» будет удалена без возможности восстановления.`
            : ''
        }
        confirmLabel={deleting ? 'Удаление…' : 'Удалить'}
        cancelLabel="Отмена"
        danger
        onCancel={() => {
          if (!deleting) setPendingDelete(null)
        }}
        onConfirm={confirmDelete}
      />
    </main>
  )
}
