import { beforeEach, describe, expect, it } from 'vitest';
import { setUi, useGame } from '../../store';

describe('CardZoomModal & store integration', () => {
  beforeEach(() => {
    setUi({ zoomedCard: null });
  });

  it('sets and clears zoomedCard via setUi', () => {
    expect(useGame.getState().ui.zoomedCard).toBeNull();

    setUi({
      zoomedCard: {
        cardId: 'corn_archer',
        instanceId: 'inst_1',
        damage: 2,
        shield: 1,
        flipped: true,
      },
    });

    expect(useGame.getState().ui.zoomedCard).toEqual({
      cardId: 'corn_archer',
      instanceId: 'inst_1',
      damage: 2,
      shield: 1,
      flipped: true,
    });

    setUi({ zoomedCard: null });
    expect(useGame.getState().ui.zoomedCard).toBeNull();
  });

  it('preserves creature damage, shield, and flipped board state in zoomedCard', () => {
    setUi({
      zoomedCard: {
        cardId: 'cool_dog',
        instanceId: 'creature_42',
        damage: 3,
        shield: 2,
        flipped: false,
      },
    });

    const zoomed = useGame.getState().ui.zoomedCard;
    expect(zoomed?.damage).toBe(3);
    expect(zoomed?.shield).toBe(2);
    expect(zoomed?.flipped).toBe(false);

    setUi({
      zoomedCard: {
        ...zoomed!,
        flipped: true,
      },
    });
    expect(useGame.getState().ui.zoomedCard?.flipped).toBe(true);
  });
});
