import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import './App.css'

const CARD_TYPES = {
  creature: 'Существо',
  building: 'Строение',
  spell: 'Заклинание',
}

const LAND_TYPES = {
  corn: { label: 'Кукурузное поле', icon: '🌽' },
  ice: { label: 'Ледяная', icon: '❄️' },
  desert: { label: 'Пустынная', icon: '🏜️' },
  good: { label: 'Добрая', icon: '🌸' },
  swamp: { label: 'Бесполезное болото', icon: '🌿' },
  sand: { label: 'Песчаная', icon: '🏖️' },
  blue: { label: 'Синяя равнина', icon: '🔵' },
  any: { label: 'Любой', icon: '🌈' },
}

const SAMPLE_CARDS = [
  { id: 'c1', card_number: 1, name: 'Ловкая кукузебра', description: '+1 к атаке за каждый уникальный тип земель под твоим контролем', card_type: 'creature', cost: 1, attack: 0, health: 6, land_type: 'corn', is_rainbow: false, has_flip: false, mechanics: [], image_url: '' },
  { id: 'c2', card_number: 2, name: 'Ледяная башня', description: 'Замораживает атакующее существо до конца хода.', card_type: 'building', cost: 3, land_type: 'ice', is_rainbow: false, has_flip: true, flip_description: 'Верни башню в руку и добери карту.', mechanics: [], image_url: '' },
  { id: 'c3', card_number: 3, name: 'Радужный всплеск', description: 'Считается картой любого типа земли и усиливает следующую карту.', card_type: 'spell', cost: 0, land_type: 'any', is_rainbow: true, has_flip: false, mechanics: [], image_url: '' },
]

const SAMPLE_LANDS = [
  { id: 'l1', name: 'Кукурузное поле', land_type: 'corn', image_url: '' },
  { id: 'l2', name: 'Ледяная пустошь', land_type: 'ice', image_url: '' },
  { id: 'l3', name: 'Добрый сад', land_type: 'good', image_url: '' },
  { id: 'l4', name: 'Синяя равнина', land_type: 'blue', image_url: '' },
]

const emptyCard = {
  card_number: '', name: '', card_type: 'creature', cost: 1, attack: 0, health: 1,
  land_type: 'corn', is_rainbow: false, has_flip: false, flip_description: '', description: '', image_url: '', mechanics: '[]',
}

function ImageThumb({ src, size = 'medium', alt }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <div className={`thumb thumb-${size}`}>🃏</div>
  return <img className={`thumb thumb-${size}`} src={src} alt={alt} onError={() => setFailed(true)} />
}

function Badge({ type, children }) {
  return <span className={`badge badge-${type}`}>{children}</span>
}

function Modal({ children, onClose, stacked = false }) {
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return <div className={`modal-overlay ${stacked ? 'modal-overlay-stacked' : ''}`} onMouseDown={onClose}><div className="modal" onMouseDown={(e) => e.stopPropagation()}>{children}</div></div>
}

function Toasts({ toasts }) {
  return <div className="toasts">{toasts.map((toast) => <div className={`toast toast-${toast.type}`} key={toast.id}>{toast.text}</div>)}</div>
}

function DeckFilters({ filters, setFilters, mode, setMode }) {
  const toggle = (key, value) => setFilters((prev) => ({ ...prev, [key]: prev[key].includes(value) ? prev[key].filter((item) => item !== value) : [...prev[key], value] }))
  return <aside className="filters">
    <label className="search-label">🔍<input placeholder="Поиск карт..." value={filters.search} onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))} /></label>
    <div className="mode-tabs"><button className={mode === 'cards' ? 'active' : ''} onClick={() => setMode('cards')}>🃏 Карты</button><button className={mode === 'lands' ? 'active' : ''} onClick={() => setMode('lands')}>🏞 Земли</button></div>
    <h3>Тип карты</h3>{Object.entries(CARD_TYPES).map(([value, label]) => <label key={value}><input type="checkbox" checked={filters.cardTypes.includes(value)} onChange={() => toggle('cardTypes', value)} /> {label}</label>)}
    <h3>Тип земель</h3>{Object.entries(LAND_TYPES).map(([value, land]) => <label key={value}><input type="checkbox" checked={filters.landTypes.includes(value)} onChange={() => toggle('landTypes', value)} /> {land.icon} {land.label}</label>)}
    <label><input type="checkbox" checked={filters.rainbow} onChange={(e) => setFilters((p) => ({ ...p, rainbow: e.target.checked }))} /> 🌈 Радужные карты</label>
    <h3>Стоимость</h3><div className="cost-row"><input type="number" value={filters.costMin} onChange={(e) => setFilters((p) => ({ ...p, costMin: e.target.value }))} /><input type="number" value={filters.costMax} onChange={(e) => setFilters((p) => ({ ...p, costMax: e.target.value }))} /></div>
    <label><input type="checkbox" checked={filters.flipOnly} onChange={(e) => setFilters((p) => ({ ...p, flipOnly: e.target.checked }))} /> Только с флюпом</label>
  </aside>
}

function CardRow({ card, count, total, add, remove }) {
  const disabled = count >= 3 || total >= 40
  return <article className="card-row"><ImageThumb src={card.image_url} alt={card.name} /><div className="card-info"><div className="meta"><span>#{card.card_number}</span><Badge type={card.card_type}>{CARD_TYPES[card.card_type]}</Badge>{card.has_flip && <Badge type="flip">ФЛЮП</Badge>}{card.is_rainbow && <Badge type="rainbow">🌈</Badge>}<Badge type="land">{LAND_TYPES[card.land_type]?.icon}</Badge></div><h3>{card.name}</h3><p>💧 {card.cost} {card.card_type === 'creature' && <> · ⚔️ {card.attack} · ❤️ {card.health}</>}</p><small>{card.description}</small></div><div className="row-actions"><strong>×{count}</strong><button title={disabled ? (count >= 3 ? 'Максимум 3 копии' : 'Максимум 40 карт') : 'Добавить карту'} disabled={disabled} onClick={() => add(card.id)}>＋</button>{count > 0 && <button title="Убрать карту" onClick={() => remove(card.id)}>−</button>}</div></article>
}

function DeckTopBar({ name, setName, cardTotal, landTotal, errors, warnings, save, clear, importDeck, code }) {
  const [importCode, setImportCode] = useState('')
  return <header className="topbar"><input aria-label="Название колоды" value={name} onChange={(e) => setName(e.target.value)} /><span className={`counter ${cardTotal === 40 ? 'full' : errors.length ? 'invalid' : 'ok'}`}>Карт: {cardTotal} / 40</span><span className={landTotal === 4 ? 'counter ok' : 'counter invalid'}>Земель: {landTotal} / 4</span><button onClick={save} disabled={errors.some((e) => e.includes('больше')) || landTotal !== 4}>💾 Сохранить колоду</button><input className="code-input" placeholder="Код DK-XXXXXX" value={importCode} onChange={(e) => setImportCode(e.target.value)} /><button onClick={() => importDeck(importCode)}>📥 Импортировать</button><button onClick={clear}>🗑️ Очистить</button>{code && <button onClick={() => navigator.clipboard?.writeText(code)}>Код: {code}</button>}<div className="validation">{warnings.map((w) => <span className="warn" key={w}>⚠️ {w}</span>)}{errors.map((e) => <span className="err" key={e}>❌ {e}</span>)}</div></header>
}

function DeckPanel({ open, onClose, selectedCards, selectedLands, cards, lands, removeCard, removeLand }) {
  useEffect(() => { const onKey = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [onClose])
  return <>{open && <div className="drawer-overlay" onClick={onClose} />}<aside className={`deck-drawer ${open ? 'open' : ''}`}><button className="close" onClick={onClose}>✕</button><h2>🎒 Твоя колода</h2><h3>🃏 Карты ({Object.values(selectedCards).reduce((a, b) => a + b, 0)} / 40)</h3>{Object.keys(selectedCards).length === 0 ? <p>Пока пусто</p> : Object.entries(selectedCards).map(([id, qty]) => { const card = cards.find((item) => item.id === id); return <div className="drawer-item" key={id}><ImageThumb src={card?.image_url} size="small" alt={card?.name} /><span>{card?.name}</span><b>×{qty}</b><button onClick={() => removeCard(id)}>−</button></div> })}<h3>🏞 Земли ({Object.values(selectedLands).reduce((a, b) => a + b, 0)} / 4)</h3>{Object.keys(selectedLands).length === 0 ? <p>Пока пусто</p> : Object.entries(selectedLands).map(([id, qty]) => { const land = lands.find((item) => item.id === id); return <div className="drawer-item" key={id}><ImageThumb src={land?.image_url} size="small" alt={land?.name} /><span>{land?.name}</span><b>×{qty}</b><button onClick={() => removeLand(id)}>−</button></div> })}</aside></>
}

function CardForm({ card, onClose, onSave, isNew, similarCards, setSimilarCards }) {
  const [form, setForm] = useState(card ? { ...card, mechanics: JSON.stringify(card.mechanics ?? [], null, 2) } : emptyCard)
  const [jsonError, setJsonError] = useState('')
  const [imageWarning, setImageWarning] = useState('')
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value, ...(key === 'cost' && Number(value) === 0 ? { is_rainbow: true, land_type: 'any' } : {}), ...(key === 'is_rainbow' && value ? { land_type: 'any' } : {}) }))
  const submit = async (force = false) => {
    let mechanics
    try { mechanics = JSON.parse(form.mechanics || '[]'); setJsonError('') } catch (e) { setJsonError(e.message); return }
    if (!form.card_number || !form.name.trim() || form.cost === '') return
    if (isNew && !force) {
      const { data } = await supabase.rpc('find_similar_cards', { p_name: form.name, p_description: form.description })
      if (data?.length) { setSimilarCards(data); return }
    }
    onSave({ ...form, card_number: Number(form.card_number), cost: Number(form.cost), attack: Number(form.attack || 0), health: Number(form.health || 0), mechanics })
  }
  useEffect(() => { const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); submit() } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) })
  return <Modal onClose={onClose}><h2>{isNew ? '➕ Новая карта' : '✏️ Редактировать карту'}</h2><div className="form-grid"><label>Номер карты<input type="number" required value={form.card_number} onChange={(e) => set('card_number', e.target.value)} /></label><label>Название<input required value={form.name} onChange={(e) => set('name', e.target.value)} /></label><label>Тип карты<select value={form.card_type} onChange={(e) => set('card_type', e.target.value)}>{Object.entries(CARD_TYPES).map(([v, l]) => <option value={v} key={v}>{l}</option>)}</select></label><label>Стоимость<input type="number" required value={form.cost} onChange={(e) => set('cost', e.target.value)} /></label>{form.card_type === 'creature' && <><label>Атака<input type="number" value={form.attack} onChange={(e) => set('attack', e.target.value)} /></label><label>Защита<input type="number" value={form.health} onChange={(e) => set('health', e.target.value)} /></label></>}<label>Тип земель<select value={form.land_type} onChange={(e) => set('land_type', e.target.value)}>{Object.entries(LAND_TYPES).map(([v, l]) => <option value={v} key={v}>{l.label}</option>)}</select></label><label><input type="checkbox" checked={form.is_rainbow} onChange={(e) => set('is_rainbow', e.target.checked)} /> Радужная карта</label><label><input type="checkbox" checked={form.has_flip} onChange={(e) => set('has_flip', e.target.checked)} /> Есть механика Флюп</label>{form.has_flip && <label>Описание флюпа<input value={form.flip_description || ''} onChange={(e) => set('flip_description', e.target.value)} /></label>}<label className="wide">Описание карты<textarea value={form.description} onChange={(e) => set('description', e.target.value)} /></label><label className="wide">URL картинки<input value={form.image_url || ''} onChange={(e) => { set('image_url', e.target.value); setImageWarning(e.target.value && !/^https?:\/\//.test(e.target.value) ? 'URL должен начинаться с http:// или https://' : '') }} /></label><div className="wide preview"><ImageThumb src={form.image_url} alt={form.name} />{imageWarning && <span className="warn">{imageWarning}</span>}<button onClick={() => setImageWarning('Превью обновлено')}>🔄 Обновить превью</button></div><label className="wide">Механики (JSON)<textarea className="mono" value={form.mechanics} onChange={(e) => set('mechanics', e.target.value)} /></label>{jsonError && <span className="err wide">Ошибка JSON: {jsonError}</span>}<details className="wide"><summary>📋 Примеры механик</summary><code>{'[{ "type": "buff", "target": "self", "attack": 1 }]'}</code></details></div><div className="modal-actions"><button onClick={() => submit()}>💾 Сохранить</button><button onClick={onClose}>❌ Отмена</button></div>{similarCards?.length > 0 && <Modal stacked onClose={() => window.confirm('Отменить создание?') && onClose()}><h2>⚠️ Найдены похожие карты</h2><p>Возможно, вы создаёте дубликат:</p>{similarCards.map((item) => <div className="similar" key={item.id || item.card_number}><ImageThumb src={item.image_url} size="small" alt={item.name} /><b>#{item.card_number} {item.name}</b><span>Схожесть: {Math.round((item.similarity || item.score || 0.3) * 100)}%</span><small>{item.description}</small></div>)}<div className="modal-actions"><button onClick={() => submit(true)}>✅ Всё равно создать</button><button onClick={() => setSimilarCards([])}>✏️ Изменить</button><button onClick={() => window.confirm('Все введённые данные будут потеряны. Продолжить?') && onClose()}>❌ Отмена</button></div></Modal>}</Modal>
}

function AdminPanel({ cards, setCards, toast, goBack }) {
  const [type, setType] = useState('all'), [land, setLand] = useState('all'), [editing, setEditing] = useState(null), [similar, setSimilar] = useState([])
  const filtered = cards.filter((card) => (type === 'all' || card.card_type === type) && (land === 'all' || card.land_type === land))
  const saveCard = async (card) => { const { data, error } = await supabase.from('cards').upsert(card).select().single(); if (error) toast('error', error.message); else { const saved = data || { ...card, id: card.id || crypto.randomUUID() }; setCards((prev) => [...prev.filter((item) => item.id !== saved.id), saved].sort((a, b) => a.card_number - b.card_number)); setEditing(null); setSimilar([]); toast('success', card.id ? '✅ Карта обновлена' : '✅ Карта создана') } }
  const remove = async (card) => { if (!window.confirm(`Удалить карту ${card.name}?`)) return; await supabase.from('cards').delete().eq('id', card.id); setCards((prev) => prev.filter((item) => item.id !== card.id)); toast('success', '🗑️ Карта удалена') }
  return <main className="admin"><div className="admin-top"><button onClick={goBack}>← Назад в меню</button><h1>🔧 Панель админа: Управление картами</h1><button className="primary" onClick={() => setEditing({ isNew: true })}>➕ Добавить новую карту</button><select value={type} onChange={(e) => setType(e.target.value)}><option value="all">Все</option>{Object.entries(CARD_TYPES).map(([v, l]) => <option value={v} key={v}>{l}</option>)}</select><select value={land} onChange={(e) => setLand(e.target.value)}><option value="all">Все земли</option>{Object.entries(LAND_TYPES).map(([v, l]) => <option value={v} key={v}>{l.label}</option>)}</select><b>Всего карт: {filtered.length}</b></div>{filtered.map((card) => <CardRow key={card.id} card={card} count={0} total={0} add={() => setEditing(card)} remove={() => remove(card)} />)}{editing && <CardForm card={editing.isNew ? null : editing} isNew={editing.isNew} onClose={() => { setEditing(null); setSimilar([]) }} onSave={saveCard} similarCards={similar} setSimilarCards={setSimilar} />}</main>
}

function App() {
  const [screen, setScreen] = useState('deck'), [cards, setCards] = useState(SAMPLE_CARDS), [lands, setLands] = useState(SAMPLE_LANDS), [selectedCards, setSelectedCards] = useState({}), [selectedLands, setSelectedLands] = useState({}), [deckName, setDeckName] = useState('Моя первая колода'), [deckCode, setDeckCode] = useState(''), [panelOpen, setPanelOpen] = useState(false), [mode, setMode] = useState('cards'), [toasts, setToasts] = useState([])
  const [filters, setFilters] = useState({ search: '', cardTypes: [], landTypes: [], rainbow: false, costMin: 0, costMax: 10, flipOnly: false })
  const toast = (type, text) => { const id = crypto.randomUUID(); setToasts((p) => [...p, { id, type, text }]); setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3000) }
  useEffect(() => { supabase.from('cards').select('*').order('card_number').then(({ data }) => data?.length && setCards(data)); supabase.from('lands').select('*').order('name').then(({ data }) => data?.length && setLands(data)) }, [])
  const cardTotal = Object.values(selectedCards).reduce((a, b) => a + b, 0), landTotal = Object.values(selectedLands).reduce((a, b) => a + b, 0)
  const filteredCards = useMemo(() => cards.filter((card) => (!filters.search || `${card.name} ${card.description}`.toLowerCase().includes(filters.search.toLowerCase())) && (!filters.cardTypes.length || filters.cardTypes.includes(card.card_type)) && (!filters.landTypes.length || filters.landTypes.includes(card.land_type)) && (!filters.rainbow || card.is_rainbow) && Number(card.cost) >= Number(filters.costMin || 0) && Number(card.cost) <= Number(filters.costMax || 99) && (!filters.flipOnly || card.has_flip)).sort((a, b) => a.card_number - b.card_number), [cards, filters])
  const addCard = (id) => setSelectedCards((p) => ({ ...p, [id]: Math.min((p[id] || 0) + 1, 3) })), removeCard = (id) => setSelectedCards((p) => { const next = { ...p, [id]: (p[id] || 0) - 1 }; if (next[id] <= 0) delete next[id]; return next })
  const addLand = (id) => landTotal < 4 && setSelectedLands((p) => ({ ...p, [id]: (p[id] || 0) + 1 })), removeLand = (id) => setSelectedLands((p) => { const next = { ...p, [id]: (p[id] || 0) - 1 }; if (next[id] <= 0) delete next[id]; return next })
  const errors = [...(cardTotal > 40 ? ['В колоде больше 40 карт'] : []), ...(landTotal !== 4 ? ['Выбрано не 4 земли'] : [])], warnings = cardTotal < 40 ? ['В колоде меньше 40 карт'] : []
  const saveDeck = async () => { const code = deckCode || `DK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`; const { error } = await supabase.from('decks').upsert({ name: deckName, code, cards: Object.entries(selectedCards).map(([card_id, quantity]) => ({ card_id, quantity })), lands: Object.entries(selectedLands).map(([land_id, quantity]) => ({ land_id, quantity })) }); if (error) toast('error', error.message); else { setDeckCode(code); toast('success', '✅ Колода сохранена') } }
  const importDeck = async (code) => { const { data, error } = await supabase.from('decks').select('*').eq('code', code).single(); if (error || !data) toast('error', 'Колода не найдена'); else { setDeckName(data.name); setDeckCode(data.code); setSelectedCards(Object.fromEntries(data.cards.map((x) => [x.card_id, x.quantity]))); setSelectedLands(Object.fromEntries(data.lands.map((x) => [x.land_id, x.quantity]))); toast('success', '✅ Колода импортирована') } }
  if (screen === 'admin') return <><AdminPanel cards={cards} setCards={setCards} toast={toast} goBack={() => setScreen('deck')} /><Toasts toasts={toasts} /></>
  return <main className="app"><DeckTopBar name={deckName} setName={setDeckName} cardTotal={cardTotal} landTotal={landTotal} errors={errors} warnings={warnings} save={saveDeck} clear={() => window.confirm('Очистить колоду?') && (setSelectedCards({}) || setSelectedLands({}))} importDeck={importDeck} code={deckCode} /><button className="admin-link" onClick={() => setScreen('admin')}>🔧 Админ-панель</button><div className="layout"><DeckFilters filters={filters} setFilters={setFilters} mode={mode} setMode={setMode} /><section className="list">{mode === 'cards' ? filteredCards.map((card) => <CardRow key={card.id} card={card} count={selectedCards[card.id] || 0} total={cardTotal} add={addCard} remove={removeCard} />) : lands.map((land) => <article className="card-row" key={land.id}><ImageThumb src={land.image_url} alt={land.name} /><div className="card-info"><h3>{LAND_TYPES[land.land_type]?.icon} {land.name}</h3><small>{LAND_TYPES[land.land_type]?.label}</small></div><div className="row-actions"><strong>×{selectedLands[land.id] || 0}</strong><button disabled={landTotal >= 4} title="Добавить землю" onClick={() => addLand(land.id)}>＋</button>{selectedLands[land.id] > 0 && <button onClick={() => removeLand(land.id)}>−</button>}</div></article>)}</section></div><button className="panel-button" onClick={() => setPanelOpen(true)}>🎒 Колода ({cardTotal})</button><DeckPanel open={panelOpen} onClose={() => setPanelOpen(false)} selectedCards={selectedCards} selectedLands={selectedLands} cards={cards} lands={lands} removeCard={removeCard} removeLand={removeLand} /><Toasts toasts={toasts} /></main>
}

export default App
