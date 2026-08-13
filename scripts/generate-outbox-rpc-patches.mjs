#!/usr/bin/env node
/**
 * Generates supabase/migrations/20260813110000_ably_outbox_rpc_patches.sql
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const outPath = resolve(root, 'supabase/migrations/20260813110000_ably_outbox_rpc_patches.sql')

const PLAY_CARD_OUTBOX = `
  PERFORM public.ably_enqueue_game_sync(
    p_game_id,
    jsonb_build_object(
      'type', 'play_card',
      'version', v_new_version,
      'actorId', p_player_id,
      'playerId', p_player_id,
      'cardIndex', p_card_index,
      'zoneIndex', p_zone_position - 1,
      'slotType', v_slot,
      'rpcData', jsonb_build_object(
        'success', TRUE,
        'version', v_new_version,
        'hand_count', jsonb_array_length(v_new_hand),
        'deck_remaining', jsonb_array_length(v_deck),
        'actions_remaining', v_actions - v_cost,
        'action_cost', v_cost,
        'card', v_card,
        'slot_type', v_slot
      ),
      'zoneCards', v_target_zone
    )
  );
`

const DRAW_OUTBOX = (drawType) => `
  PERFORM public.ably_enqueue_game_sync(
    p_game_id,
    jsonb_build_object(
      'type', 'draw',
      'version', v_new_version,
      'actorId', p_player_id,
      'playerId', p_player_id,
      'rpcData', jsonb_build_object(
        'success', TRUE,
        'version', v_new_version,
        'hand_count', jsonb_array_length(v_hand),
        'deck_remaining', jsonb_array_length(v_deck),
        'draw_type', '${drawType}'${drawType === 'paid' ? ",\n        'actions_remaining', v_actions - 1" : ''}
      )
    )
  );
`

function extractFunction(sql, fnName) {
  const startRe = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fnName}\\b`, 'i')
  const start = sql.search(startRe)
  if (start === -1) throw new Error(`Function ${fnName} not found`)

  const tail = sql.slice(start)
  const asIdx = tail.search(/\nAS \$\$|\nAS \$function\$/i)
  if (asIdx === -1) throw new Error(`Function ${fnName} AS block not found`)

  const afterAs = tail.slice(asIdx)
  const endMatch = afterAs.match(/\nEND;\n(?:\$\$|\$function\$);/)
  if (!endMatch) throw new Error(`Function ${fnName} END not found`)

  const end = asIdx + afterAs.indexOf(endMatch[0]) + endMatch[0].length
  return tail.slice(0, end).replace(/\r\n/g, '\n')
}

function injectBeforeReturnSuccess(body, insertSql) {
  const normalized = body.replace(/\r\n/g, '\n')
  const markers = [
    "RETURN jsonb_build_object(\n    'success', TRUE,",
    "RETURN jsonb_build_object(\n    'success', TRUE",
    "RETURN jsonb_build_object('success', TRUE,",
    "RETURN jsonb_build_object('success', TRUE",
  ]
  let idx = -1
  for (const marker of markers) {
    const at = normalized.lastIndexOf(marker)
    if (at > idx) idx = at
  }
  if (idx === -1) throw new Error('success RETURN not found in ' + normalized.slice(0, 120))
  return normalized.slice(0, idx) + insertSql + '\n\n  ' + normalized.slice(idx)
}

const gameplay = readFileSync(
  resolve(root, 'supabase/migrations/20260813000000_gameplay_improvements.sql'),
  'utf8'
).replace(/\r\n/g, '\n')
const combat = readFileSync(
  resolve(root, 'supabase/migrations/20260802190000_creature_counter_attack.sql'),
  'utf8'
).replace(/\r\n/g, '\n')
const discardZone = readFileSync(
  resolve(root, 'supabase/migrations/20260802140000_zone_slots_discard.sql'),
  'utf8'
).replace(/\r\n/g, '\n')
const turnControl = readFileSync(
  resolve(root, 'supabase/migrations/20260801235900_fix_turn_control.sql'),
  'utf8'
).replace(/\r\n/g, '\n')
const lobbyUpsert = readFileSync(
  resolve(root, 'supabase/migrations/20260726050000_upsert_lobby_player_guest.sql'),
  'utf8'
).replace(/\r\n/g, '\n')
const startGame = readFileSync(
  resolve(root, 'supabase/migrations/20260802230000_deck_validation_start_game.sql'),
  'utf8'
).replace(/\r\n/g, '\n')
const landSetup = readFileSync(
  resolve(root, 'supabase/migrations/20260802120000_land_setup_phase.sql'),
  'utf8'
).replace(/\r\n/g, '\n')

const END_TURN_OUTBOX = `
      PERFORM public.ably_enqueue_game_sync(
        p_game_id,
        jsonb_build_object(
          'type', 'end_turn',
          'version', v_new_version,
          'actorId', p_player_id,
          'rpcData', jsonb_build_object(
            'success', TRUE,
            'version', v_new_version,
            'next_player_id', v_next_player_id,
            'drew_card', false,
            'actions_remaining', 2,
            'battle_events', v_battle_events,
            'game_finished', FALSE
          )
        )
      );`

const END_TURN_FINISHED_OUTBOX = `
      PERFORM public.ably_enqueue_game_sync(
        p_game_id,
        jsonb_build_object(
          'type', 'end_turn',
          'version', v_new_version,
          'actorId', p_player_id,
          'rpcData', jsonb_build_object(
            'success', TRUE,
            'version', v_new_version,
            'battle_events', v_battle_events,
            'game_finished', TRUE,
            'winner_id', v_winner_id
          )
        )
      );`

let endTurn = extractFunction(gameplay, 'end_turn')
endTurn = endTurn.replace(
  "      RETURN jsonb_build_object(\n        'success', TRUE,\n        'version', v_new_version,\n        'battle_events', v_battle_events,\n        'game_finished', TRUE,",
  END_TURN_FINISHED_OUTBOX + "\n\n      RETURN jsonb_build_object(\n        'success', TRUE,\n        'version', v_new_version,\n        'battle_events', v_battle_events,\n        'game_finished', TRUE,"
)
endTurn = endTurn.replace(
  "  RETURN jsonb_build_object(\n    'success', TRUE,\n    'version', v_new_version,\n    'next_player_id', v_next_player_id,",
  END_TURN_OUTBOX + "\n\n  RETURN jsonb_build_object(\n    'success', TRUE,\n    'version', v_new_version,\n    'next_player_id', v_next_player_id,"
)

const ATTACK_OUTBOX = `
  PERFORM public.ably_enqueue_game_sync(
    p_game_id,
    jsonb_build_object(
      'type', 'attack',
      'version', v_new_version,
      'actorId', p_player_id,
      'rpcData', jsonb_build_object(
        'success', TRUE,
        'version', v_new_version,
        'from_player_id', p_player_id,
        'from_zone', p_from_zone,
        'to_player_id', p_to_player_id,
        'to_zone', p_to_zone,
        'damage', v_damage_amount,
        'counter_damage', CASE WHEN v_creature IS NULL THEN 0 ELSE COALESCE(v_counter, 0) END,
        'face_damage', v_face_damage,
        'creature_killed', v_creature_killed,
        'creature_damaged', v_creature_damaged,
        'attacker_killed', v_attacker_killed,
        'attacker_damaged', v_attacker_damaged,
        'defender_health', v_def_health,
        'game_finished', v_face_damage > 0 AND v_def_health <= 0
      )
    )
  );`

const parts = [
  '-- Ably outbox: RPC patches (stage 2 + lobby stage 6)',
  '',
  injectBeforeReturnSuccess(extractFunction(gameplay, 'play_card'), PLAY_CARD_OUTBOX),
  '',
  injectBeforeReturnSuccess(extractFunction(gameplay, 'draw_free_card'), DRAW_OUTBOX('free')),
  '',
  injectBeforeReturnSuccess(extractFunction(gameplay, 'draw_card_for_action'), DRAW_OUTBOX('paid')),
  '',
  injectBeforeReturnSuccess(
    extractFunction(gameplay, 'shuffle_deck'),
    `\n  PERFORM public.ably_publish_game_reload(p_game_id, p_player_id, v_new_version);`
  ),
  '',
  injectBeforeReturnSuccess(
    extractFunction(gameplay, 'discard_from_hand'),
    `\n  PERFORM public.ably_publish_game_reload(p_game_id, p_player_id, v_new_version);`
  ),
  '',
  injectBeforeReturnSuccess(
    extractFunction(discardZone, 'discard_from_zone'),
    `\n  PERFORM public.ably_publish_game_reload(p_game_id, p_player_id, v_new_version + 1);`
  ),
  '',
  injectBeforeReturnSuccess(extractFunction(combat, 'perform_attack'), ATTACK_OUTBOX),
  '',
  endTurn,
]

let confirmSetup = extractFunction(gameplay, 'confirm_land_setup')
confirmSetup = confirmSetup.replace(
  '  WHERE game_id = p_game_id AND player_id = v_first_player_id;\nEND;',
  `  WHERE game_id = p_game_id AND player_id = v_first_player_id;

  PERFORM public.ably_publish_game_reload(p_game_id, p_player_id, (SELECT version FROM public.games WHERE id = p_game_id));
END;`
)
parts.push('', confirmSetup)

let reorderLands = extractFunction(landSetup, 'reorder_player_lands')
reorderLands = reorderLands.replace(
  '  END LOOP;\nEND;',
  `  END LOOP;

  PERFORM public.ably_publish_game_reload(
    p_game_id,
    p_player_id,
    COALESCE((SELECT version FROM public.games WHERE id = p_game_id), 0)
  );
END;`
)
parts.push('', reorderLands)

let forfeit = extractFunction(turnControl, 'forfeit_game')
forfeit = forfeit.replace(
  "    RETURN jsonb_build_object('success', TRUE, 'finished', TRUE, 'winner_id', v_winner, 'version', v_new_version);",
  `    PERFORM public.ably_publish_game_reload(p_game_id, p_guest_id, v_new_version);
    RETURN jsonb_build_object('success', TRUE, 'finished', TRUE, 'winner_id', v_winner, 'version', v_new_version);`
)
forfeit = forfeit.replace(
  "  RETURN jsonb_build_object(\n    'success', TRUE,\n    'finished', FALSE,",
  `  PERFORM public.ably_publish_game_reload(p_game_id, p_guest_id, v_new_version);
  RETURN jsonb_build_object(
    'success', TRUE,
    'finished', FALSE,`
)
parts.push('', forfeit)

parts.push(
  '',
  `CREATE OR REPLACE FUNCTION public.flip_card(
  p_game_id UUID,
  p_player_id TEXT,
  p_zone_position INT,
  p_card_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game RECORD;
  v_zone JSONB;
  v_new_zone JSONB := '[]'::jsonb;
  v_new_version INT;
  elem JSONB;
  v_card_id TEXT;
  v_found BOOLEAN := FALSE;
BEGIN
  IF p_zone_position < 1 OR p_zone_position > 4 THEN
    RETURN jsonb_build_object('error', 'Неверная позиция зоны (1-4)');
  END IF;

  SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR v_game.status <> 'active' THEN
    RETURN jsonb_build_object('error', 'Игра не активна');
  END IF;

  SELECT COALESCE(cards, '[]'::jsonb) INTO v_zone
  FROM game_zones
  WHERE game_id = p_game_id AND player_id = p_player_id AND zone_position = p_zone_position
  FOR UPDATE;

  IF v_zone IS NULL THEN
    RETURN jsonb_build_object('error', 'Зона не найдена');
  END IF;

  FOR elem IN SELECT value FROM jsonb_array_elements(v_zone) LOOP
    v_card_id := COALESCE(elem->>'id', elem->>'instanceId');
    IF NOT v_found AND v_card_id = p_card_id THEN
      v_found := TRUE;
      v_new_zone := v_new_zone || jsonb_build_array(
        elem || jsonb_build_object('status', 'flipped', 'flipped', true)
      );
    ELSE
      v_new_zone := v_new_zone || jsonb_build_array(elem);
    END IF;
  END LOOP;

  IF NOT v_found THEN
    RETURN jsonb_build_object('error', 'Карта не найдена');
  END IF;

  v_new_version := COALESCE(v_game.version, 0) + 1;

  UPDATE game_zones SET cards = v_new_zone, updated_at = now()
  WHERE game_id = p_game_id AND player_id = p_player_id AND zone_position = p_zone_position;

  UPDATE games SET version = v_new_version, updated_at = now() WHERE id = p_game_id;

  PERFORM public.ably_enqueue_game_sync(
    p_game_id,
    jsonb_build_object(
      'type', 'flip_card',
      'version', v_new_version,
      'actorId', p_player_id,
      'playerId', p_player_id,
      'zoneIndex', p_zone_position - 1,
      'cardId', p_card_id
    )
  );

  RETURN jsonb_build_object('success', TRUE, 'version', v_new_version);
END;
$$;

GRANT EXECUTE ON FUNCTION public.flip_card(UUID, TEXT, INT, TEXT) TO anon, authenticated;`
)

parts.push(
  '',
  `CREATE OR REPLACE FUNCTION public.leave_lobby(
  p_guest_id TEXT,
  p_lobby_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_host_id TEXT;
BEGIN
  IF p_guest_id IS NULL OR length(trim(p_guest_id)) < 16 THEN
    RAISE EXCEPTION 'Некорректный guest_id';
  END IF;
  PERFORM set_config('app.guest_id', p_guest_id, true);

  SELECT host_id INTO v_host_id FROM public.lobbies WHERE id = p_lobby_id;
  IF v_host_id IS NULL THEN
    RAISE EXCEPTION 'Лобби не найдено';
  END IF;

  IF v_host_id = p_guest_id THEN
    PERFORM public.ably_enqueue_lobby_sync(
      p_lobby_id,
      jsonb_build_object('type', 'closed', 'actorId', p_guest_id)
    );
    DELETE FROM public.lobbies WHERE id = p_lobby_id;
    RETURN;
  END IF;

  DELETE FROM public.lobby_players
  WHERE lobby_id = p_lobby_id AND player_id = p_guest_id;

  PERFORM public.ably_publish_lobby_players(p_lobby_id, p_guest_id);
END;
$$;

REVOKE ALL ON FUNCTION public.leave_lobby(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_lobby(TEXT, UUID) TO anon, authenticated;`
)

let upsert = extractFunction(lobbyUpsert, 'upsert_lobby_player')
upsert = upsert.replace(
  '  RETURN result;\nEND;',
  `  PERFORM public.ably_publish_lobby_players(p_lobby_id, p_guest_id);
  RETURN result;
END;`
)
parts.push('', upsert)

let setReadyFn = extractFunction(lobbyUpsert, 'set_lobby_player_ready')
setReadyFn = setReadyFn.replace(
  '  RETURN result;\nEND;',
  `  PERFORM public.ably_publish_lobby_players(p_lobby_id, p_guest_id);
  RETURN result;
END;`
)
parts.push('', setReadyFn)

let startGameFn = extractFunction(startGame, 'start_game_for_lobby')
startGameFn = startGameFn.replace(
  "  UPDATE public.lobbies SET status = 'in_game' WHERE id = p_lobby_id;\n  RETURN v_game_id;",
  `  UPDATE public.lobbies SET status = 'in_game' WHERE id = p_lobby_id;

  PERFORM public.ably_enqueue_lobby_sync(
    p_lobby_id,
    jsonb_build_object(
      'type', 'game_started',
      'gameId', v_game_id,
      'status', 'in_game',
      'actorId', p_guest_id
    )
  );

  RETURN v_game_id;`
)
parts.push('', startGameFn)
parts.push('', "NOTIFY pgrst, 'reload schema';")

writeFileSync(outPath, parts.join('\n'), 'utf8')
console.log('Wrote', outPath)
