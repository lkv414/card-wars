import { describe, expect, it, beforeEach } from 'vitest';
import { inspectCard, setUi, useGame } from '../../store';

describe('CardInspector & store integration', () => {
  beforeEach(() => {
    setUi({
      inspectedCard: null,
      zoomedCard: null,
      inspectorCollapsed: false,
    });
  });

  it('sets and updates inspectedCard via inspectCard helper', () => {
    expect(useGame.getState().ui.inspectedCard).toBeNull();

    inspectCard({ cardId: 'corn_archer', instanceId: 'inst_1', damage: 2, shield: 1, flipped: true });
    expect(useGame.getState().ui.inspectedCard).toEqual({
      cardId: 'corn_archer',
      instanceId: 'inst_1',
      damage: 2,
      shield: 1,
      flipped: true,
    });

    inspectCard(null);
    expect(useGame.getState().ui.inspectedCard).toBeNull();
  });

  it('supports toggling inspectorCollapsed state', () => {
    expect(useGame.getState().ui.inspectorCollapsed).toBe(false);

    setUi({ inspectorCollapsed: true });
    expect(useGame.getState().ui.inspectorCollapsed).toBe(true);

    setUi({ inspectorCollapsed: false });
    expect(useGame.getState().ui.inspectorCollapsed).toBe(false);
  });
});
