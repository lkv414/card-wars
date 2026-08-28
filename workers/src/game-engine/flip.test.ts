import { describe, it, expect } from "vitest"
import { canFlipCard, flipCard } from "./cards"
import type { GameState, Card, Zone, PlayerState } from "./types"

function makeCard(id: string, mechanics: unknown[] | undefined): Card {
  return {
    id,
    instanceId: `inst-${id}`,
    name: id,
    attack: 1,
    health: 1,
    flipped: false,
    mechanics: mechanics as unknown as Card["mechanics"],
  }
}

function makeState(card: Card): GameState {
  const zone: Zone = {
    zone_position: 1,
    cards: [card],
    land_id: "corn",
    land_type: "corn",
  }
  const player: PlayerState = {
    player_id: "p1",
    health: 25,
    player_order: 1,
    hand: [],
    deck_pile: [],
    deck_remaining: 0,
    discard_pile: [],
    actions_remaining: 2,
    free_draw_used: false,
    paid_draw_used: false,
    zones: [zone],
  }
  return {
    id: "g1",
    status: "active",
    current_turn: 1,
    current_player_id: "p1",
    version: 1,
    players: [player],
  }
}

describe("FLOOP is free + detectable from nested mechanics", () => {
  it("card with flip_ability in mechanics[] is flippable and costs 0 actions", () => {
    const card = makeCard("c1", [
      {
        trigger: "on_flip",
        actions: [{ type: "flip_ability", target: "none", effect: "нанеси 1 урон" }],
        conditions: [],
        description: "",
        source_text: "",
      },
    ])
    const state = makeState(card)

    const check = canFlipCard(state, "p1", 1, "inst-c1")
    expect(check.ok).toBe(true)
    expect(check.cost).toBe(0)

    const res = flipCard(state, { type: "flip_card", zonePosition: 1, cardId: "inst-c1" })
    expect("error" in res).toBe(false)
    if ("error" in res) return
    // Flipping must NOT spend an action point.
    expect(res.state.players[0]!.actions_remaining).toBe(2)
    expect(res.state.players[0]!.zones[0]!.cards[0]!.flipped).toBe(true)
  })

  it("card without any flip ability is NOT flippable", () => {
    const card = makeCard("c2", [{ trigger: "manual", actions: [{ type: "manual", effect: "x" }], conditions: [], description: "", source_text: "" }])
    const state = makeState(card)
    expect(canFlipCard(state, "p1", 1, "inst-c2").ok).toBe(false)
  })
})
