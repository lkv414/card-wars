import type { DomainDeps, GameEvent, MatchState, PlayerId } from '@card-wars/domain';

function cardName(deps: DomainDeps, cardId: string): string {
  return deps.catalog.getCard(cardId)?.name ?? cardId;
}

function nick(state: MatchState, playerId: PlayerId | null | undefined): string {
  if (!playerId) return '—';
  return state.players[playerId]?.nickname ?? playerId;
}

/**
 * Journal lines from events (docs/RULES.md «Журнал партии»: время — игрок — действие;
 * the Room prepends the timestamp). Pure: no clocks, no I/O.
 */
export function journalLines(deps: DomainDeps, state: MatchState, events: GameEvent[]): string[] {
  const lines: string[] = [];
  for (const event of events) {
    const line = formatEvent(deps, state, event);
    if (line) lines.push(line);
  }
  return lines;
}

function formatEvent(deps: DomainDeps, state: MatchState, event: GameEvent): string | null {
  switch (event.type) {
    case 'match_started': {
      const mode =
        event.mode === 'teams'
          ? event.teamVariant === 'wall'
            ? ' (2 на 2, стенка)'
            : ' (2 на 2, соседи)'
          : '';
      const roster = event.players
        .map((p) => `${p.nickname} (${deps.catalog.getHero(p.heroId)?.name ?? p.heroId})`)
        .join(', ');
      return `Партия начата${mode}: ${roster}. Первым ходит ${nick(state, event.firstPlayer)}`;
    }
    case 'mulligan_made':
      return `${nick(state, event.player)} сделал муллиган`;
    case 'mulligan_kept':
      return `${nick(state, event.player)} оставил стартовую руку`;
    case 'turn_started':
      return `Ход ${event.turn} (круг ${event.round}) — ${nick(state, event.player)}`;
    case 'phase_changed':
      return event.phase === 'combat'
        ? `${nick(state, event.player)} переходит в бой`
        : null; // draw/main фазы шумны — в журнал не пишем
    case 'card_drawn':
      return `${nick(state, event.player)} тянет карт: ${event.count}`;
    case 'card_played': {
      const replaced = event.replacedInstanceId ? ' (замена)' : '';
      return `${nick(state, event.player)} играет ${cardName(deps, event.cardId)} в зону ${event.zone + 1}${replaced}`;
    }
    case 'companion_played': {
      const replaced = event.replacedInstanceId ? ' (замена)' : '';
      return `${nick(state, event.player)} разыгрывает парную карту ${cardName(deps, event.cardId)}${replaced}`;
    }
    case 'spell_cast':
      return event.copy
        ? `${nick(state, event.player)} копирует заклинание ${cardName(deps, event.cardId)}`
        : `${nick(state, event.player)} читает заклинание ${cardName(deps, event.cardId)}`;
    case 'token_changed':
      return `Ледяных жетонов на земле ${event.zone + 1} ${nick(state, event.player)}: ${event.iceTokens}`;
    case 'floop_used': {
      const paid = event.paidActions > 0 ? ` (−${event.paidActions} действие)` : '';
      return `${nick(state, event.player)} флюпает ${cardName(deps, event.cardId)}${paid}`;
    }
    case 'damage_dealt': {
      if (event.targetInstanceId) {
        const inst = state.instances[event.targetInstanceId];
        const target = inst ? cardName(deps, inst.cardId) : 'существо';
        const shield = event.absorbedByShield > 0 ? `, щит поглотил ${event.absorbedByShield}` : '';
        return `${target} получает ${event.amount} урона${shield}`;
      }
      if (event.targetPlayer) {
        return `${nick(state, event.targetPlayer)} получает ${event.amount} урона (жизни: ${state.players[event.targetPlayer]?.lives ?? '?'})`;
      }
      return null;
    }
    case 'creature_healed':
      return `существо восстановило ${event.amount} здоровья`;
    case 'lives_changed':
      return `${nick(state, event.player)}: жизни ${event.lives} (${event.delta > 0 ? '+' : ''}${event.delta})`;
    case 'creature_destroyed':
      return `${cardName(deps, event.cardId)} уничтожено и уходит в сброс`;
    case 'card_discarded':
      return `${nick(state, event.player)} сбрасывает ${cardName(deps, event.cardId)} (из ${
        event.from === 'hand' ? 'руки' : event.from === 'deck' ? 'колоды' : event.from === 'companion' ? 'парной зоны' : 'поля'
      })`;
    case 'card_removed':
      return `${nick(state, event.player)} убирает ${cardName(deps, event.cardId)} из игры`;
    case 'card_returned':
      return `${nick(state, event.player)} возвращает ${cardName(deps, event.cardId)} из сброса в руку`;
    case 'land_changed': {
      const what = event.change === 'frozen' ? 'заморожена' : event.change === 'unfrozen' ? 'разморожена' : event.change === 'flipped' ? 'перевёрнута' : event.change === 'type_changed' ? 'меняет тип' : 'перевёрнута обратно';
      return `земля ${event.zone + 1} игрока ${nick(state, event.player)} ${what}`;
    }
    case 'bonus_changed':
      return `${cardName(deps, event.cardId)}: бонусы АТК ${event.bonusAttack >= 0 ? '+' : ''}${event.bonusAttack} / ЗАЩ ${event.bonusDefense >= 0 ? '+' : ''}${event.bonusDefense}`;
    case 'shield_changed':
      return `${cardName(deps, event.cardId)}: щит ${event.shield}`;
    case 'card_moved':
      return `${cardName(deps, state.instances[event.instanceId]?.cardId ?? '')} перемещается: зона ${event.fromZone + 1} → ${event.toZone + 1}`;
    case 'cards_revealed':
      return `${nick(state, event.player)} открывает: ${event.cardIds
        .map((id) => cardName(deps, state.instances[id]?.cardId ?? id))
        .join(', ')}`;
    case 'choice_required':
      return event.kind === 'optional'
        ? `${nick(state, event.player)} решает: применить способность?`
        : `${nick(state, event.player)} выбирает цель (${(event.askIndex ?? 0) + 1}/${event.askCount ?? '?'})`;
    case 'choice_resolved':
      return null; // сам факт ответа шумен; следствие видно по событиям эффекта
    case 'hero_ability_used':
      return `${nick(state, event.player)} активирует способность героя`;
    case 'battle_ready':
      return `${nick(state, event.player)} готов к бою`;
    case 'timer_expired':
      return `время хода ${nick(state, event.player)} истекло — автоматический бой`;
    case 'player_eliminated':
      return `${nick(state, event.player)} выбывает`;
    case 'player_surrendered':
      return `${nick(state, event.player)} сдаётся`;
    case 'player_disconnected':
      return `${nick(state, event.player)} не вернулся в игру (обрыв соединения)`;
    case 'match_finished': {
      const reason = event.reason === 'surrender' ? 'сдача' : event.reason === 'disconnect' ? 'обрыв соединения' : 'ликвидация';
      const who = event.winners.length > 0 ? event.winners.map((w) => nick(state, w)).join(', ') : 'никто';
      return `Партия завершена (${reason}). Победа: ${who}`;
    }
  }
}
