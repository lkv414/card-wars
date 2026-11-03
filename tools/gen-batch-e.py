# One-off generator: batch E mechanics JSON. Safe to delete.
import json

D = 'content/cards/mechanics'

def w(cid, name, abilities):
    json.dump({'cardId': cid, 'name': name, 'abilities': abilities},
              open(f'{D}/{cid}.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

def cast(effect, text, targets=None):
    a = {'kind': 'passive', 'trigger': 'on_cast', 'effect': effect, 'text': text}
    if targets:
        a['targets'] = targets
    return a

def on_enters(effect, text, targets=None, optional=None, conditions=None):
    a = {'kind': 'passive', 'trigger': 'on_enters_play', 'effect': effect, 'text': text}
    if targets:
        a['targets'] = targets
    if optional:
        a['optional'] = True
    if conditions:
        a['conditions'] = conditions
    return a

def trig(trigger, effect, text, targets=None, conditions=None, optional=None):
    a = {'kind': 'passive', 'trigger': trigger, 'effect': effect, 'text': text}
    if targets:
        a['targets'] = targets
    if conditions:
        a['conditions'] = conditions
    if optional:
        a['optional'] = True
    return a

def aura(effect, text, conditions=None):
    a = {'kind': 'passive', 'effect': effect, 'text': text}
    if conditions:
        a['conditions'] = conditions
    return a

def active(effect, text, cost=None, targets=None, additional=None, once=None):
    a = {'kind': 'active', 'effect': effect, 'text': text}
    if cost is not None:
        a['cost'] = cost
    if targets:
        a['targets'] = targets
    if additional:
        a['additionalCost'] = additional
    if once:
        a['oncePerTurn'] = True
    return a

w('ftg_card_37', 'Кукурузная мышь', [active({'op': 'deal_damage', 'target': {'kind': 'choice', 'index': 0}, 'amount': {'kind': 'per_distinct_lands', 'amount': 1}}, 'Потрать 1 Действие >>> Нанеси 1 урон выбранному существу на этой линии за каждый различный тип земли под твоим контролем.', cost=1, targets=[{'kind': 'lane_creature'}])])
w('ftg_card_38', 'Золотой шакал', [active({'op': 'deal_damage', 'target': {'kind': 'each_creature_opponent'}, 'amount': 1}, 'ПРИЕМ, сбрось песчаную карту >>> Нанеси 1 урон каждому существу противника.', additional={'discardFromHand': 1})])
w('ftg_card_83', 'Кактус бандит', [aura({'op': 'stat_buff', 'target': {'kind': 'adjacent_creatures'}, 'stat': 'attack', 'amount': 1, 'duration': 'aura', 'filter': {'landType': 'corn'}}, 'Соседние Кукурузные существа получают +1 ATK.')])
w('ftg_card_86', 'Мозговой смерч', [cast({'op': 'return_to_owner', 'target': {'kind': 'each_creature_yours'}}, 'Верни всех своих существ в игре себе в руку (включая украденных существ).')])
w('ftg_card_88', 'Портал антипризыва', [cast({'op': 'return_to_owner', 'target': {'kind': 'choice', 'index': 0}}, 'Верни выбранное существо его владельцу в руку.', [{'kind': 'any_creature'}])])
w('ftg_card_91', 'Песчаная пирамида', [active([{'op': 'return_to_owner', 'target': {'kind': 'this_lane_creature'}}, {'op': 'return_to_owner', 'target': {'kind': 'this_lane_opponent_creature'}}], 'Потрать 2 Действия >>> Верни каждое существо на этой линии в руку своему владельцу. (Влияет на обоих игроков.)', cost=2)])
w('ftg_card_114', 'Призрачный маяк', [active({'op': 'stat_buff', 'target': {'kind': 'choice', 'index': 0}, 'stat': 'attack', 'amount': {'kind': 'per_discard', 'every': 5, 'amount': 1}, 'duration': 'this_turn'}, 'Потрать 1 Действие >>> Выбранное Существо на этой линии получает +1 ATK в этом ходу за каждые 5 карт в твоей стопке сброса.', cost=1, targets=[{'kind': 'lane_creature'}])])
w('ftg_card_116', 'Теневая пирамида', [active([{'op': 'draw_cards', 'count': 1}, {'op': 'discard_from_hand', 'count': 1}], 'ПРИЕМ >>> Тяни карту. Если ты контролируешь существо на этой линии, сбрось карту.', targets=[{'kind': 'own_hand_card'}], conditions=[{'kind': 'while_zone_has_creature'}])])
w('grand_prix_card_3', 'Дуэт', [cast([{'op': 'heal', 'target': {'kind': 'choice', 'index': 0}, 'amount': 1}, {'op': 'heal', 'target': {'kind': 'choice', 'index': 1}, 'amount': 1}], 'Восстанови 1 урон у Существа под твоим контролем и 1 урон у существа не под твоим контролем.', [{'kind': 'own_creature'}, {'kind': 'lane_creature'}])])
w('grand_prix_card_30', 'Лобстер-спасатель', [on_enters({'op': 'heal', 'target': {'kind': 'choice', 'index': 0}, 'amount': 1}, 'Каждый раз когда существо вступает в игру во время твоего хода, ты должен восстановить 1 урон с другого существа.', targets=[{'kind': 'own_creature'}], conditions=[{'kind': 'if_payload_player_self'}, {'kind': 'if_payload_other'}])])
w('grand_prix_card_33', 'Отражающий камнекраб', [trig('on_damage_dealt', {'op': 'deal_damage', 'target': {'kind': 'triggering_instance'}, 'amount': {'kind': 'payload_damage', 'amount': 1}}, 'Каждый раз когда Камнекраб получает урон от существа, он наносит столько же урона этому же существу.', conditions=[{'kind': 'if_payload_targeted_self'}, {'kind': 'if_payload_creature'}])])
w('grand_prix_card_34', 'Камнекраб регулировщик', [trig('on_damage_dealt', {'op': 'move_creature', 'target': {'kind': 'triggering_instance'}, 'destination': {'kind': 'choice', 'index': 0}, 'side': 'any'}, 'Каждый раз когда Камнекраб регулировщик получает урон от существа, можешь переместить это существо на пустую соседнюю линию.', targets=[{'kind': 'landscape'}], conditions=[{'kind': 'if_payload_targeted_self'}, {'kind': 'if_payload_creature'}], optional=True)])
w('ftg_card_10', 'Волшебник-гастролер', [on_enters({'mechanic': 'swap_lanes', 'params': {'opponent': True}}, 'Когда Волшебник-гастролер вступает в игру, Существо противника на этой линии и Волшебник-гастролер меняются местами.', targets=[{'kind': 'lane_opponent_creature'}])])
w('ftg_card_87', 'Портал в никуда', [cast({'op': 'move_creature', 'target': {'kind': 'choice', 'index': 0}, 'destination': {'kind': 'choice', 'index': 1}, 'side': 'any'}, 'Передвинь 1 существо противника на соседнюю пустую линию (на его стороне).', [{'kind': 'opponent_creature'}, {'kind': 'landscape'}])])
print('batch E written')
