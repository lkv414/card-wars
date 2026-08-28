import { describe, it, expect } from "vitest"
import {
  DrawCards,
  DealDamage,
  GainActions,
  Destroy,
  Search,
  Manual,
  Passive,
  Imperative,
  hydrateAction,
  hydrateMechanics,
  type Action,
} from "./mechanics"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const MECH_JSON = resolve(__dirname, "../../../исходники/cards.with_mechanics.json")

describe("hydrateAction — round-trip count/amount contract", () => {
  it("DrawCards: Python stores `count`, hydrate must read it (not 0)", () => {
    const a = hydrateAction({ type: "draw_cards", target: "none", count: 3, source: "deck" })
    expect(a).toBeInstanceOf(DrawCards)
    expect((a as DrawCards).count).toBe(3)
  })

  it("GainActions / Destroy / Search read `count`", () => {
    expect((hydrateAction({ type: "gain_actions", count: 2 }) as GainActions).count).toBe(2)
    expect((hydrateAction({ type: "destroy", target: "chosen_opponent_creature", count: 4 }) as Destroy).count).toBe(4)
    expect((hydrateAction({ type: "search", count: 5 }) as Search).count).toBe(5)
  })

  it("DealDamage still uses `amount`", () => {
    const a = hydrateAction({ type: "deal_damage", target: "each_creature_opponent", amount: 2 })
    expect((a as DealDamage).amount).toBe(2)
  })

  it("no count-based action hydrates to 0 (regression guard)", () => {
    for (const type of ["draw_cards", "discard_cards", "gain_actions", "destroy", "search", "peek", "mill"]) {
      const a = hydrateAction({ type, target: "none" })
      const count = (a as unknown as { count: number }).count
      if (typeof count === "number") expect(count).toBeGreaterThan(0)
    }
  })
})

describe("hydrateAction — manual/passive are real types, not imperative", () => {
  it("manual keeps effect text", () => {
    const a = hydrateAction({ type: "manual", target: "none", effect: "нанеси 1 урон" })
    expect(a).toBeInstanceOf(Manual)
    expect((a as Manual).effect).toBe("нанеси 1 урон")
  })

  it("passive keeps effect text", () => {
    const a = hydrateAction({ type: "passive", target: "none", effect: "+1 ATK" })
    expect(a).toBeInstanceOf(Passive)
    expect((a as Passive).effect).toBe("+1 ATK")
  })

  it("unknown type falls back to Imperative but preserves effect", () => {
    const a = hydrateAction({ type: "weird_x", target: "none", effect: "do thing" })
    expect(a).toBeInstanceOf(Imperative)
    expect((a as Imperative).effect).toBe("do thing")
  })
})

describe("hydrateMechanics on real parsed data (исходники/cards.with_mechanics.json)", () => {
  const raw = JSON.parse(readFileSync(MECH_JSON, "utf8"))
  const cards = Array.isArray(raw) ? raw : Object.values(raw)

  it("every draw/gain action has count >= 1 (no data loss from count/amount bug)", () => {
    let bad = 0
    for (const card of cards) {
      const mechs = hydrateMechanics(card.mechanics ?? [], String(card.card_number ?? ""))
      for (const m of mechs) {
        for (const act of m.actions) {
          if (["draw_cards", "discard_cards", "gain_actions"].includes(act.type)) {
            if ((act as unknown as { count: number }).count < 1) bad++
          }
        }
      }
    }
    expect(bad).toBe(0)
  })

  it("manual/passive actions hydrate to their classes and keep effect", () => {
    let manualOk = 0
    let passiveOk = 0
    for (const card of cards) {
      const mechs = hydrateMechanics(card.mechanics ?? [], String(card.card_number ?? ""))
      for (const m of mechs) {
        for (const act of m.actions) {
          if (act.type === "manual" && act instanceof Manual && act.effect) manualOk++
          if (act.type === "passive" && act instanceof Passive && act.effect) passiveOk++
        }
      }
    }
    expect(manualOk).toBeGreaterThan(0)
    expect(passiveOk).toBeGreaterThan(0)
  })
})
