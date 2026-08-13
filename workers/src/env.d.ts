export interface Env {
  GAME_ROOM: DurableObjectNamespace
  LOBBY_ROOM: DurableObjectNamespace
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  ENVIRONMENT?: string
}
