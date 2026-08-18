import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CardForm } from './CardForm'
import { ConfirmDialog } from './Shared/ConfirmDialog'
import { AdminBulkEdit } from './admin/AdminBulkEdit'
import { AdminFilters } from './admin/AdminFilters'
import { AdminCardTile } from './admin/AdminCardTile'
import {
  exportCatalogJson,
  exportCatalogCsv,
  parseCatalogImport,
  downloadTextFile,
} from '../utils/adminCatalogExport'
import { useAdminAuth } from '../context/useAdminAuth'
import {
  DEFAULT_ADMIN_FILTERS,
  buildAnomalyMap,
  countAnomalies,
  filterAdminCards,
  hasActiveAdminFilters,
} from '../utils/adminCardValidation'

export function AdminPanel({
  cards,
  toast,
  createCard,
  updateCard,
  deleteCard,
  findSimilarCards,
}) {
  const navigate = useNavigate()
  const { signOut } = useAdminAuth()
  const [filters, setFilters] = useState({ ...DEFAULT_ADMIN_FILTERS })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [editing, setEditing] = useState(null)
  const [similar, setSimilar] = useState([])
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const anomalyMap = useMemo(() => buildAnomalyMap(cards), [cards])
  const stats = useMemo(() => countAnomalies(anomalyMap), [anomalyMap])

  const filtered = useMemo(
    () => filterAdminCards(cards, filters, anomalyMap),
    [cards, filters, anomalyMap]
  )

  const resetFilters = () => setFilters({ ...DEFAULT_ADMIN_FILTERS })

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

  const filtersActive = hasActiveAdminFilters(filters)

  const toggleSelect = (card) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(card.id)) next.delete(card.id)
      else next.add(card.id)
      return next
    })
  }

  const handleTileClick = (card) => {
    if (selectMode) toggleSelect(card)
    else setEditing(card)
  }

  const applyBulk = async (ids, patch) => {
    for (const id of ids) {
      const card = cards.find((c) => c.id === id)
      if (!card) continue
      const result = await updateCard(id, { ...card, ...patch })
      if (!result?.success) {
        toast('error', result.error || 'Bulk update failed')
        return
      }
    }
    toast('success', `Обновлено карт: ${ids.length}`)
  }

  const handleImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const { cards: imported, error } = parseCatalogImport(text)
    if (error) {
      toast('error', error)
      return
    }
    let ok = 0
    for (const row of imported) {
      if (!row.name || row.card_number == null) continue
      const result = await createCard(row)
      if (result.success) ok += 1
    }
    toast('success', `Импортировано: ${ok}`)
    e.target.value = ''
  }

  return (
    <main className="admin-panel">
      <header className="admin-header">
        <div className="admin-header-start">
          <button type="button" className="deck-icon-btn" onClick={() => navigate('/deck')} aria-label="К редактору">
            ←
          </button>
          <div className="admin-header-brand">
            <h1>Каталог карт</h1>
            <p className="admin-header-sub">Проверка данных и редактирование</p>
          </div>
        </div>

        <div className="admin-header-stats" aria-label="Сводка качества">
          <span className="admin-stat-pill admin-stat-pill--total">{cards.length} карт</span>
          <span className="admin-stat-pill admin-stat-pill--ok">{stats.clean} OK</span>
          {stats.warnings > 0 && (
            <span className="admin-stat-pill admin-stat-pill--warn">{stats.warnings} ⚠</span>
          )}
          {stats.errors > 0 && (
            <span className="admin-stat-pill admin-stat-pill--err">{stats.errors} !</span>
          )}
        </div>

        <div className="admin-header-actions">
          <button type="button" className="deck-link-btn" onClick={() => setSelectMode((v) => !v)}>
            {selectMode ? '✓ Выбор' : 'Выбор'}
          </button>
          <button type="button" className="deck-link-btn" onClick={() => downloadTextFile('catalog.json', exportCatalogJson(cards))}>
            JSON
          </button>
          <button type="button" className="deck-link-btn" onClick={() => downloadTextFile('catalog.csv', exportCatalogCsv(cards), 'text/csv')}>
            CSV
          </button>
          <label className="deck-link-btn admin-import-label">
            Импорт
            <input type="file" accept="application/json,.json" hidden onChange={handleImport} />
          </label>
          <button type="button" className="deck-link-btn" onClick={() => signOut()}>
            Выйти
          </button>
          <button
            type="button"
            className={`deck-filters-btn ${filtersOpen ? 'is-active' : ''} ${filtersActive ? 'has-active' : ''}`}
            aria-expanded={filtersOpen}
            aria-controls="admin-filters"
            onClick={() => setFiltersOpen((v) => !v)}
          >
            Фильтры{filtersActive ? ' •' : ''}
          </button>
          <button type="button" className="primary admin-add-btn" onClick={() => setEditing({ isNew: true })}>
            + Карта
          </button>
        </div>
      </header>

      <div className="admin-layout">
        <AdminFilters
          filters={filters}
          setFilters={setFilters}
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          onReset={resetFilters}
          stats={stats}
        />

        <section className="admin-library" aria-label="Список карт">
          <div className="admin-toolbar">
            <span className="admin-toolbar-count">
              Показано <strong>{filtered.length}</strong> из {cards.length}
            </span>
            {filtersActive && (
              <button type="button" className="deck-link-btn" onClick={resetFilters}>
                Сбросить фильтры
              </button>
            )}
          </div>

          <AdminBulkEdit
            selectedIds={selectedIds}
            onApply={applyBulk}
            onClear={() => setSelectedIds(new Set())}
          />

          {filtered.length === 0 ? (
            <div className="admin-empty" role="status">
              <p>Нет карт по выбранным фильтрам</p>
              <button type="button" className="deck-link-btn" onClick={resetFilters}>
                Показать все
              </button>
            </div>
          ) : (
            <div className="admin-cards-grid" role="list">
              {filtered.map((card) => (
                <div role="listitem" key={card.id}>
                  <AdminCardTile
                    card={card}
                    issues={anomalyMap.get(card.id) || []}
                    selected={selectedIds.has(card.id)}
                    onClick={handleTileClick}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
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
