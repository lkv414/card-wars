import { useEffect, useMemo } from 'react';
import type { CardView, Command, PlayerView } from '@card-wars/protocol';
import { cards as catalog } from '@card-wars/content';
import { Scene } from '../scene/Scene';
import { setConnectionSink, useGame } from '../../store';

// DEV-превью сцены без сервера (?scene=1): сцена — функция снапшота, поэтому
// достаточно подложить мок-вид и стаб-приёмник команд. Панель справа меняет
// урон, чтобы проверять кучку жетонов (падение, 1+1 → 3). Не для партии.

const firstOf = (type: string, index = 0): string =>
  catalog.filter((c) => c.type === type)[index]?.id ?? 'bmo_card_1';

function cardView(instanceId: string, cardId: string, damage = 0, flipped = false): CardView {
  const meta = catalog.find((c) => c.id === cardId);
  return {
    instanceId,
    cardId,
    damage,
    shield: 0,
    bonusAttack: 0,
    bonusDefense: 0,
    flipped,
    effAttack: meta?.attack ?? 0,
    effDefense: meta?.defense ?? 0,
  };
}

const landTypes = ['corn', 'blue', 'ice', 'swamp'];

function buildView(): PlayerView {
  const handIds = [
    firstOf('creature', 3),
    firstOf('building', 0),
    firstOf('spell', 0),
    firstOf('creature', 4),
    firstOf('creature', 5),
  ];
  const hand = handIds.map((cardId, i) => ({ instanceId: `h${i}`, cardId }));
  const player = (
    id: string,
    nickname: string,
    heroId: string,
    d0: number,
    d1: number,
  ) => ({
    id,
    nickname,
    heroId,
    lives: 23,
    maxLives: 25,
    actions: 2,
    connected: true,
    lands: landTypes.map((type, i) => ({ type, frozen: i === 2 && id === 'p1', flipped: false })),
    zones: [
      {
        creature: cardView(`${id}-c0`, firstOf('creature', 0), d0),
        building: null,
      },
      { creature: cardView(`${id}-c1`, firstOf('creature', 1), d1), building: null },
      {
        creature: null,
        building: id === 'p1' ? cardView(`${id}-b2`, firstOf('building', 0)) : null,
      },
      { creature: null, building: null },
    ],
    deckCount: 31,
    handCount: 5,
    discard: [{ instanceId: `${id}-d0`, cardId: firstOf('creature', 2) }],
    companion: null,
    surrendered: false,
    eliminated: false,
    teamId: null,
    battleReady: false,
    mulliganDecision: null,
  });

  return {
    status: 'running',
    phase: 'main',
    mode: 'ffa',
    teamVariant: null,
    anyLand: false,
    teams: null,
    turn: 3,
    round: 2,
    activePlayers: ['p1'],
    activePlayer: 'p1',
    order: ['p1', 'p2'],
    me: 'p1',
    players: {
      p1: player('p1', 'Я (мок)', 'hero_bmo', 2, 1),
      p2: player('p2', 'Соперник (мок)', 'hero_billy', 3, 0),
    },
    myHand: hand,
    castSpells: [],
    revealed: {},
    myPeek: [],
    pending: null,
    winners: null,
    finishReason: null,
    journal: [],
    myWord: null,
  };
}

/** Стаб команд: применяет минимум, нужный для проверки UI, прямо в мок-вид. */
function applyMockCommand(view: PlayerView, command: Command): PlayerView {
  const next = structuredClone(view);
  const me = next.players[next.me]!;
  const findSlot = (instanceId: string): 'creature' | 'building' | null => {
    for (const zone of me.zones) {
      if (zone.creature?.instanceId === instanceId) return 'creature';
      if (zone.building?.instanceId === instanceId) return 'building';
    }
    return null;
  };
  switch (command.type) {
    case 'play_card': {
      const card = next.myHand.find((c) => c.instanceId === command.instanceId);
      if (!card || command.zone === undefined) break;
      const meta = catalog.find((c) => c.id === card.cardId);
      const slot = meta?.type === 'building' ? 'building' : 'creature';
      me.zones[command.zone]![slot] = cardView(command.instanceId, card.cardId);
      next.myHand = next.myHand.filter((c) => c.instanceId !== command.instanceId);
      break;
    }
    case 'discard_from_hand': {
      next.myHand = next.myHand.filter((c) => c.instanceId !== command.instanceId);
      break;
    }
    case 'discard_from_field': {
      const slot = findSlot(command.instanceId);
      if (slot) me.zones = me.zones.map((z) => ({ ...z, [slot]: z[slot]?.instanceId === command.instanceId ? null : z[slot] }));
      else if (me.companion?.instanceId === command.instanceId) me.companion = null;
      break;
    }
    case 'floop': {
      const slot = findSlot(command.instanceId);
      if (slot) {
        me.zones = me.zones.map((z) => ({
          ...z,
          [slot]: z[slot]?.instanceId === command.instanceId ? { ...z[slot]!, flipped: true } : z[slot],
        }));
      } else if (me.companion?.instanceId === command.instanceId) {
        me.companion = { ...me.companion, flipped: true };
      }
      break;
    }
    default:
      break;
  }
  return next;
}

export function MockScene() {
  const initial = useMemo(() => buildView(), []);

  useEffect(() => {
    useGame.setState({ view: initial, status: 'match' });
    setConnectionSink({
      sendCommand: (command) => {
        useGame.setState((s) => (s.view ? { view: applyMockCommand(s.view, command) } : {}));
      },
      lobbyCommand: () => {},
      hurry: () => {},
    });
    // Отладка drag&drop в мок-режиме: снимок ui из консоли/тестов.
    (window as unknown as Record<string, unknown>).__ui = () => useGame.getState().ui;
  }, [initial]);

  // Панель управления уроном для проверки кучки жетонов.
  const bumpDamage = (pid: 'p1' | 'p2', delta: number) => {
    useGame.setState((s) => {
      if (!s.view) return {};
      const view = structuredClone(s.view);
      const creature = view.players[pid]!.zones[0]!.creature;
      if (creature) creature.damage = Math.max(0, creature.damage + delta);
      return { view };
    });
  };

  return (
    <div className="game-3d">
      <Scene />
      <div
        style={{
          position: 'fixed',
          top: 12,
          right: 12,
          zIndex: 20,
          display: 'grid',
          gap: 6,
          padding: 12,
          background: 'rgba(16,20,28,0.85)',
          borderRadius: 12,
          pointerEvents: 'auto',
        }}
      >
        <b style={{ color: '#e8edf4' }}>Мок-сцена (без сервера)</b>
        <button onClick={() => bumpDamage('p1', 1)}>+1 урон моему существу</button>
        <button onClick={() => bumpDamage('p1', -1)}>−1 урон моему существу</button>
        <button onClick={() => bumpDamage('p2', 1)}>+1 урон чужому существу</button>
        <button onClick={() => useGame.setState({ view: buildView() })}>Сброс вида</button>
        <span style={{ color: '#9fb0c3', maxWidth: 220 }}>
          Драг из руки: зона — сыграть, стопка сброса — сбросить. Зажатие карты на поле 1 с — флюп,
          движение — драг в сброс.
        </span>
      </div>
    </div>
  );
}
