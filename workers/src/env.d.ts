export interface Env {
  GAME_ROOM: DurableObjectNamespace
  LOBBY_ROOM: DurableObjectNamespace
  ENVIRONMENT?: string
  /** Local-only escape hatch; never set in production secrets/vars. */
  ALLOW_DEV_BYPASS?: string
}
