/** Format battle events for game log and replay. */

export function formatBattleEvent(ev) {
  const dmg = Number(ev.damage ?? ev.amount ?? 0)
  const counter = Number(ev.counter_damage ?? ev.counterDamage ?? 0)
  const face = Number(ev.face_damage ?? 0)
  const fromZone = Number(ev.from_zone ?? ev.fromZone ?? 0)
  const toZone = Number(ev.to_zone ?? ev.toZone ?? 0)
  const parts = []

  if (dmg > 0 && face <= 0) {
    parts.push(`⚔️ ${dmg} урона · зона ${toZone || '?'}`)
  }
  if (counter > 0) {
    parts.push(`↩️ контратака ${counter}`)
  }
  if (face > 0) {
    parts.push(`💥 ${face} по игроку`)
  }
  if (ev.killed || ev.defender_killed) {
    parts.push('☠️ существо погибло')
  }

  return {
    type: 'battle',
    message: parts.length ? parts.join(' · ') : 'Бой',
    detail: { fromZone, toZone, dmg, counter, face, raw: ev },
    timestamp: ev.timestamp ?? Date.now(),
  }
}

export function appendBattleEventsToLog(log, battleEvents) {
  const base = Array.isArray(log) ? [...log] : []
  const events = Array.isArray(battleEvents) ? battleEvents : []
  for (const ev of events) {
    const formatted = formatBattleEvent(ev)
    base.push({
      timestamp: formatted.timestamp,
      message: formatted.message,
      type: 'battle',
      battle: formatted.detail,
    })
  }
  return base
}

export function mergeLogWithBattle(log, battleEvents) {
  if (!battleEvents?.length) return log || []
  return appendBattleEventsToLog(log, battleEvents)
}
