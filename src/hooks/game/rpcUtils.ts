/**
 * Shared helpers for Supabase RPC error handling in game hooks.
 */

type RpcErrorLike = {
  message?: string
  code?: string
} | null | undefined

export function isRpcUnavailable(err: RpcErrorLike): boolean {
  const msg = err?.message || ''
  return (
    /does not exist/i.test(msg) ||
    /schema cache/i.test(msg) ||
    /Could not find the function/i.test(msg) ||
    err?.code === 'PGRST202'
  )
}

export function rpcUnavailableMessage(action = 'Действие'): string {
  return `${action} недоступно (обновите сервер)`
}
