import { useState } from 'react'
import { supabase } from '../utils/supabase'
import { ImageThumb } from './Shared/ImageThumb'
import { CardForm } from './CardForm'
import { CARD_TYPES, LAND_TYPES } from './DeckFilters'

export function AdminPanel({ cards, setCards, toast, goBack }) {
  const [type, setType] = useState('all')
  const [land, setLand] = useState('all')
  const [editing, setEditing] = useState(null)
  const [similar, setSimilar] = useState([])

  const filtered = cards.filter(
    (card) => (type === 'all' || card.card_type === type) && (land === 'all' || card.land_type === land)
  )

  const saveCard = async (card) => {
    const { data, error } = await supabase.from('cards').upsert(card).select().single()

    if (error) {
      toast('error', error.message)
    } else {
      const saved = data || { ...card, id: card.id || crypto.randomUUID() }
      setCards((prev) =>
        [...prev.filter((item) => item.id !== saved.id), saved].sort((a, b) => a.card_number - b.card_number)
      )
      setEditing(null)
      setSimilar([])
      toast('success', card.id ? '✅ Карта обновлена' : '✅ Карта создана')
    }
  }

  const remove = async (card) => {
    if (!window.confirm(`Удалить карту ${card.name}?`)) return

    await supabase.from('cards').delete().eq('id', card.id)
    setCards((prev) => prev.filter((item) => item.id !== card.id))
    toast('success', '🗑️ Карта удалена')
  }

  return (
    <main className="admin">
      <div className="admin-top">
        <button onClick={goBack}>← Назад в меню</button>
        <h1>🔧 Панель админа: Управление картами</h1>
        <button className="primary" onClick={() => setEditing({ isNew: true })}>
          ➕ Добавить новую карту
        </button>

        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">Все</option>
          {Object.entries(CARD_TYPES).map(([v, l]) => (
            <option value={v} key={v}>
              {l}
            </option>
          ))}
        </select>

        <select value={land} onChange={(e) => setLand(e.target.value)}>
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
          <div key={card.id} className="card-item" onClick={() => setEditing(card)}>
            <ImageThumb src={card.image_url} size="medium" alt={card.name} />
            <div className="card-item-info">
              <h4>{card.name}</h4>
              <small>#{card.card_number}</small>
            </div>
          </div>
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
          onDelete={remove}
        />
      )}
    </main>
  )
}
