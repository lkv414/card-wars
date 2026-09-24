"""Normalize individual_cards mechanics for the Supabase/worker engine.

The rebuilt catalog contains three generations of mechanic data:
* structured trigger/actions objects;
* flat action objects;
* short string labels from earlier manual extraction.

This script keeps structured data, reparses descriptions when possible, and
converts anything not executable by workers/src/game-engine/mechanics.ts into
an explicit generic imperative/passive action instead of silently pretending it
is a supported game action.
"""
from __future__ import annotations

import copy
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDIVIDUAL = ROOT / "individual_cards" / "cards.json"
REPORT = ROOT / "individual_cards" / "mechanics-review.json"
sys.path.insert(0, str(ROOT / "scripts"))
import parse_mechanics  # noqa: E402

SUPPORTED_ACTIONS = {
    "deal_damage", "aoe_damage", "heal", "draw_cards", "discard_cards",
    "search", "destroy", "move", "return_from_discard", "flip_landscape",
    "freeze_landscape", "stat_buff", "gain_actions", "manual", "passive",
    "flip_ability", "ignore_damage", "face_attack", "play_for_free",
    "cost_reduction", "immunity", "imperative", "peek", "mill",
}

TARGET_ALIASES = {
    "friendly_creature_on_lane": "this_creature",
    "friendly_creature": "this_creature",
    "chosen_friendly_creature": "chosen_creature",
    "each_friendly_creature": "each_creature_yours",
    "friendly_creatures": "each_creature_yours",
    "each_opponent_creature": "each_creature_opponent",
    "opponent_creatures_on_lane": "each_creature_opponent",
    "opponent_creature_on_lane": "chosen_opponent_creature",
    "chosen_opponent_creature_on_lane": "chosen_opponent_creature",
    "each_opponent_without_hand": "each_creature_no_hand",
    "adjacent_cute_creatures": "each_creature_adjacent",
    "random_swamp_creature": "chosen_discard",
    "friendly_creature_on_building_land": "each_creature_landscape",
    "each_undamaged_friendly_creature": "each_creature_yours",
    "this_card": "this_creature",
    "random": "chosen_discard",
}

TRIGGER_ALIASES = {
    "on_applied": "on_enters_play",
    "on_play": "on_enters_play",
    "on_attack": "on_creature_attacks",
    "on_deal_damage": "on_damage_dealt",
    "on_damage_dealt": "on_damage_dealt",
    "on_damage_taken": "on_damage_taken",
    "on_applied": "on_enters_play",
    "aura": "persistent",
    "persistent": "persistent",
    "conditional": "conditional",
    "start_of_turn": "start_of_turn",
    "turn_start": "start_of_turn",
    "on_enter": "on_enters_play",
    "on_enters_play": "on_enters_play",
    "on_line_change": "on_line_change",
    "on_leave": "on_death",
    "on_attack": "on_creature_attacks",
    "on_deal_damage": "on_damage_dealt",
    "on_damage_taken": "on_damage_taken",
    "end_of_turn": "end_of_turn",
    "on_draw": "on_draw",
}


def text(value) -> str:
    return str(value or "").strip()


def infer_trigger(value: str, description: str) -> str:
    raw = text(value).lower().replace(" ", "_")
    if raw in TRIGGER_ALIASES:
        return TRIGGER_ALIASES[raw]
    if "turn_start" in raw or "start_of_turn" in raw:
        return "start_of_turn"
    if "on_enter" in raw or "enters" in raw:
        return "on_enters_play"
    if "on_attack" in raw or "attack" in raw and "damage" not in raw:
        return "on_creature_attacks"
    if "line_change" in raw or "move" in raw and "on_" in raw:
        return "on_line_change"
    if "conditional" in raw:
        return "conditional"
    if "flip" in raw:
        return "on_flip"
    if "passive" in raw or "aura" in raw or "buff" in raw or "while" in raw:
        return "persistent"
    return "manual"


def normalize_target(value) -> str:
    raw = text(value) or "none"
    return TARGET_ALIASES.get(raw, raw)


def normalize_action(action: dict, card_description: str) -> tuple[dict, str]:
    original_type = text(action.get("type")) or "imperative"
    if original_type in SUPPORTED_ACTIONS:
        out = copy.deepcopy(action)
        out["type"] = original_type
        out["target"] = normalize_target(out.get("target"))
        return out, "supported"

    effect = text(action.get("effect")) or text(action.get("action")) or text(action.get("description"))
    if not effect:
        effect = card_description
    out = {
        "type": "passive" if original_type in {"passive", "aura", "persistent"} else "imperative",
        "target": normalize_target(action.get("target")),
        "effect": effect,
    }
    # Keep the source type for audit/UI without pretending it is executable.
    out["source_type"] = original_type
    return out, "generic"


def make_generic_mechanic(raw, description: str) -> dict:
    if isinstance(raw, str):
        label = raw
        trigger = infer_trigger(label, description)
        action = {"type": "passive" if trigger in {"persistent", "conditional"} else "imperative", "target": "none", "effect": label, "source_type": "unparsed_description"}
    elif isinstance(raw, dict):
        label = text(raw.get("action")) or text(raw.get("effect")) or text(raw.get("description"))
        trigger = infer_trigger(text(raw.get("type")) + " " + text(raw.get("trigger")), description)
        action = normalize_action(raw, description)[0]
    else:
        label = description
        trigger = "manual"
        action = {"type": "imperative", "target": "none", "effect": label or description, "source_type": "unparsed_description"}
    return {
        "trigger": trigger,
        "actions": [action],
        "conditions": [],
        "description": label or description,
        "source_text": description or label,
    }


def normalize_mechanic(raw, description: str) -> tuple[dict, str]:
    if not isinstance(raw, dict) or not isinstance(raw.get("actions"), list):
        return make_generic_mechanic(raw, description), "generic"
    out = {
        "trigger": TRIGGER_ALIASES.get(text(raw.get("trigger")), text(raw.get("trigger")) or "manual"),
        "actions": [],
        "conditions": raw.get("conditions") if isinstance(raw.get("conditions"), list) else [],
        "description": text(raw.get("description")) or description,
        "source_text": text(raw.get("source_text")) or description,
    }
    source = "supported"
    for action in raw["actions"]:
        if isinstance(action, dict):
            normalized, kind = normalize_action(action, description)
            out["actions"].append(normalized)
            if kind == "generic" or normalized.get("source_type"):
                source = "generic"
        else:
            out["actions"].append({"type": "imperative", "target": "none", "effect": text(action) or description})
            source = "generic"
    return out, source


def main() -> None:
    cards = json.loads(INDIVIDUAL.read_text(encoding="utf-8"))
    counts = Counter()
    target_changes = Counter()
    for card in cards:
        description = text(card.get("description"))
        current = card.get("mechanics")
        current_structured = isinstance(current, list) and any(
            isinstance(x, dict) and isinstance(x.get("actions"), list) for x in current
        )
        if current_structured:
            parsed = [copy.deepcopy(x) for x in current if isinstance(x, dict) and isinstance(x.get("actions"), list)]
            counts["kept_structured"] += 1
        elif description:
            probe = copy.deepcopy(card)
            parse_mechanics.parse_card(probe)
            parsed = copy.deepcopy(probe.get("mechanics") or [])
            if parsed:
                counts["reparsed_description"] += 1
            else:
                parsed = [make_generic_mechanic(x, description) for x in (current or [description])]
                counts["generic_description"] += 1
        else:
            parsed = []
            counts["empty_description"] += 1

        normalized = []
        for raw in parsed:
            mechanic, source = normalize_mechanic(raw, description)
            counts[f"mechanic_{source}"] += 1
            for action in mechanic.get("actions", []):
                original = text(action.get("source_type"))
                if original:
                    target_changes[original] += 1
            normalized.append(mechanic)
        card["mechanics"] = normalized
        if not description:
            card["mechanics"] = []

    # Deterministic validations before writing.
    valid_triggers = set(parse_mechanics.TRIGGER_NAMES.values())
    invalid = []
    for card in cards:
        for mechanic in card["mechanics"]:
            if mechanic["trigger"] not in valid_triggers:
                invalid.append((card["name"], mechanic["trigger"]))
            for action in mechanic["actions"]:
                if action.get("type") not in SUPPORTED_ACTIONS:
                    invalid.append((card["name"], action.get("type")))
    if invalid:
        raise RuntimeError(f"Invalid normalized mechanics: {invalid[:10]}")

    INDIVIDUAL.write_text(json.dumps(cards, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report = {
        "cards": len(cards),
        "cards_with_description": sum(bool(text(c.get("description"))) for c in cards),
        "cards_with_mechanics": sum(bool(c.get("mechanics")) for c in cards),
        "cards_with_empty_mechanics": sum(not c.get("mechanics") for c in cards),
        "counts": dict(sorted(counts.items())),
        "generic_source_types": dict(target_changes.most_common()),
        "engine_supported_action_types": sorted(SUPPORTED_ACTIONS),
        "note": "Generic actions preserve unresolved rules as text; they are not executable by the current engine.",
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
