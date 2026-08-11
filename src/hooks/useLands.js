import { useSupabaseTable } from './useSupabaseTable'

export function useLands() {
  const { rows: lands, loading, error, reload: loadLands } = useSupabaseTable('lands', {
    orderBy: 'name',
    hookName: 'useLands',
  })

  return { lands, loading, error, loadLands }
}
