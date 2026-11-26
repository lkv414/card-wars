import { useEffect, useRef, useState } from 'react';
import type { PlayerView } from '@card-wars/protocol';
import { sendCommand, sendTomato, setUi, toggleHandCollapsed, toggleTomatoMode, useGame } from '../../store';
import { pick, startForPending } from '../targeting';
import { catalog } from '@card-wars/content';
import { CardZoomModal } from './CardZoomModal';
import {
  MatchFinishOverlay,
  OrientationGate,
} from './DiegeticHud';
import { soundEngine } from '../../sound/SoundEngine';

/** HUD поверх 3D-канваса (docs/UI.md «Панель игрока»): всё кнопочное — DOM. */
export function Hud({ code }: { code: string }) {
  const view = useGame((s) => s.view)!;
  const error = useGame((s) => s.error);
  const unfreezePrompt = useGame((s) => s.ui.unfreezePrompt);
  const handCollapsed = useGame((s) => s.ui.handCollapsed);
  const me = view.players[view.me]!;
  // Match-start word choice — boundaries live in the hero's catalog data (docs §H7).
  const wordSetup = catalog.getHero(me.heroId)?.wordSetup;
  const targeting = useGame((st) => st.ui.targeting);
  const activeEmote = useGame((st) => st.ui.activeEmote);
  const tomatoMode = useGame((st) => st.ui.tomatoMode);
  const tomatoSplats = useGame((st) => st.ui.tomatoSplats);

  useEffect(() => {
    const ui = useGame.getState().ui;
    if (
      view.pending &&
      view.pending.player === view.me &&
      (view.pending.kind === 'target' || view.pending.kind === 'effect_step') &&
      !ui.targeting
    ) {
      const state = startForPending(view, view.pending);
      if (state) setUi({ targeting: state });
    }
    if (!view.pending && ui.targeting && ui.targeting.mode === 'pending') {
      setUi({ targeting: null });
    }
  }, [view.pending, view]);

  const targetingPick = (candidate: Parameters<typeof pick>[2]) => {
    const ui = useGame.getState().ui;
    if (!ui.targeting) {
      if (view.pending?.player === view.me) {
        soundEngine.playCardSelect();
        sendCommand({ type: 'resolve_choice', player: view.me, answer: { targets: [candidate] } });
      }
      return;
    }
    const result = pick(view, ui.targeting, candidate);
    if (!result.accepted) {
      soundEngine.playError();
      return;
    }
    soundEngine.playCardSelect();
    if (result.command) {
      sendCommand(result.command);
      setUi({ targeting: result.nextState ?? null });
    } else if (result.nextState) {
      setUi({ targeting: result.nextState });
    }
  };

  /**
   * Non-board answers (docs/MECHANICS-V2.md §H1): number and named branch.
   * For a pending `effect_step` there is no client TargetingState, so the
   * answer goes straight to resolve_choice.
   */
  const submitChoice = (candidate: Parameters<typeof pick>[2]) => {
    if (useGame.getState().ui.targeting) {
      targetingPick(candidate);
      return;
    }
    if (view.pending?.player === view.me) {
      soundEngine.playCardSelect();
      sendCommand({ type: 'resolve_choice', player: view.me, answer: { targets: [candidate] } });
    }
  };

  const currentAsk = (() => {
    if (view.pending?.kind === 'target' || view.pending?.kind === 'effect_step') {
      const ability = view.pending.cardId
        ? catalog.getCard(view.pending.cardId)?.abilities?.[view.pending.abilityIndex ?? 0]
        : catalog.getHero(view.players[view.pending.player]!.heroId)?.ability;
      return ability?.targets?.[view.pending.askIndex ?? 0] ?? null;
    }
    if (targeting) return targeting.asks[targeting.askIndex] ?? null;
    return null;
  })();

  const renderPlayerTargetButtons = () => {
    if (!currentAsk) return null;
    if (currentAsk.kind === 'opponent_player') {
      const opponents = view.order.filter((pid) => {
        if (pid === view.me) return false;
        const mePlayer = view.players[view.me];
        const other = view.players[pid];
        if (mePlayer?.teamId && other?.teamId === mePlayer.teamId) return false;
        return true;
      });
      return (
        <span className="pending-player-buttons" style={{ display: 'inline-flex', gap: 6, margin: '0 6px', verticalAlign: 'middle', flexWrap: 'wrap' }}>
          {opponents.map((pid) => (
            <button
              key={pid}
              className="cw-btn-3d btn-red btn-sm"
              onClick={() => targetingPick({ kind: 'player', playerId: pid })}
              title={`Выбрать соперника ${view.players[pid]?.nickname ?? pid}`}
            >
              ⚔️ {view.players[pid]?.nickname ?? pid} ({view.players[pid]?.lives} ❤️)
            </button>
          ))}
        </span>
      );
    }
    if (currentAsk.kind === 'any_player') {
      return (
        <span className="pending-player-buttons" style={{ display: 'inline-flex', gap: 6, margin: '0 6px', verticalAlign: 'middle', flexWrap: 'wrap' }}>
          {view.order.map((pid) => {
            const isMe = pid === view.me;
            return (
              <button
                key={pid}
                className={`cw-btn-3d ${isMe ? 'btn-blue' : 'btn-orange'} btn-sm`}
                onClick={() => targetingPick({ kind: 'player', playerId: pid })}
                title={`Выбрать игрока ${view.players[pid]?.nickname ?? pid}`}
              >
                {isMe ? '👤 Вы (себе)' : `👤 ${view.players[pid]?.nickname ?? pid}`} ({view.players[pid]?.lives} ❤️)
              </button>
            );
          })}
        </span>
      );
    }
    return null;
  };

  const [amountInput, setAmountInput] = useState('');
  const [distribution, setDistribution] = useState<string[]>([]);
  const [wordInput, setWordInput] = useState('');

  const revealedForPendingPlayer = view.pending ? view.revealed[view.pending.player] ?? [] : [];
  const cardNameById = (cardId: string): string => catalog.getCard(cardId)?.name ?? cardId;

  const pendingSourceInfo = (() => {
    if (!view.pending) return null;
    if (view.pending.cardId) {
      const card = catalog.getCard(view.pending.cardId);
      const ability = card?.abilities?.[view.pending.abilityIndex ?? 0];
      return {
        name: card?.name ?? view.pending.cardId,
        text: ability?.text || card?.description || '',
      };
    }
    const ownerHeroId = view.players[view.pending.player]?.heroId;
    const hero = ownerHeroId ? catalog.getHero(ownerHeroId) : undefined;
    return {
      name: hero?.name ?? 'Герой',
      text: hero?.ability?.text || hero?.text || '',
    };
  })();

  /**
   * Выбор карты из стопки сброса (Поднятие мертвых, Лунный урожай).
   * Сброс публичен, но в 3D видна только верхняя карта — поэтому перечисляем
   * карты списком в баннере ожидания (как вскрытые карты выше).
   */
  const discardPickers = (() => {
    const askInfo = (() => {
      if (view.pending?.kind === 'target' || view.pending?.kind === 'effect_step') {
        const ability = view.pending.cardId
          ? catalog.getCard(view.pending.cardId)?.abilities?.[view.pending.abilityIndex ?? 0]
          : catalog.getHero(view.players[view.pending.player]!.heroId)?.ability;
        const ask = ability?.targets?.[view.pending.askIndex ?? 0];
        return ask ? { kind: ask.kind, filter: ask.filter } : null;
      }
      if (targeting) {
        const ask = targeting.asks[targeting.askIndex];
        return ask ? { kind: ask.kind, filter: ask.filter } : null;
      }
      return null;
    })();
    if (!askInfo || (askInfo.kind !== 'own_discard_card' && askInfo.kind !== 'any_discard_card' && askInfo.kind !== 'visible_card')) {
      return null;
    }
    const filter = askInfo.filter;
    const pools: Array<{ label: string; cards: Array<{ instanceId: string; cardId: string }> }> = [];
    const usable = (cardId: string): boolean => {
      if (!filter) return true;
      const card = catalog.getCard(cardId);
      if (!card) return false;
      if (filter.cardType && card.type !== filter.cardType) return false;
      if (filter.maxCost !== undefined && card.cost > filter.maxCost) return false;
      if (filter.cardIds && !filter.cardIds.includes(cardId)) return false;
      return true;
    };
    if (askInfo.kind === 'own_discard_card') {
      pools.push({
        label: 'твой сброс',
        cards: (view.players[view.me]?.discard ?? []).filter((c) => usable(c.cardId)),
      });
    } else {
      for (const pid of view.order) {
        const p = view.players[pid]!;
        const cards = p.discard.filter((c) => usable(c.cardId));
        if (cards.length === 0) continue;
        pools.push({ label: `сброс: ${p.nickname}`, cards });
      }
    }
    return (
      <div className="revealed-picker" aria-label="Карты из сброса">
        {pools.map((pool) => (
          <span key={pool.label} className="revealed-pool">
            <span className="hint">{pool.label}:</span>
            {pool.cards.map((card) => (
              <button
                key={card.instanceId}
                className="revealed-card cw-btn-3d btn-paper btn-sm"
                onClick={() => targetingPick({ kind: 'card', instanceId: card.instanceId })}
              >
                {cardNameById(card.cardId)}
              </button>
            ))}
          </span>
        ))}
      </div>
    );
  })();

  /** Числовой ввод и выбор ветки «ИЛИ» (docs/MECHANICS-V2.md §H1). */
  const nonBoardPicker = (() => {
    if (!currentAsk) return null;
    if (view.pending && view.pending.player !== view.me) return null;
    if (!view.pending && targeting?.mode !== 'active') return null;
    if (currentAsk.kind === 'amount') {
      const min = currentAsk.min ?? 0;
      const max = currentAsk.max ?? 99;
      const value = Number(amountInput);
      return (
        <span className="revealed-pool">
          <span className="hint">{currentAsk.label ?? 'Введите число'}: {min}–{max}</span>
          <input
            type="number"
            min={min}
            max={max}
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            style={{ width: 64 }}
            aria-label="Число"
          />
          <button
            className="cw-btn-3d btn-green btn-sm"
            disabled={amountInput === '' || !Number.isInteger(value) || value < min || value > max}
            onClick={() => {
              submitChoice({ kind: 'amount', value });
              setAmountInput('');
            }}
          >
            ОК
          </button>
        </span>
      );
    }
    if (currentAsk.kind === 'choose_option') {
      return (
        <span className="revealed-pool">
          <span className="hint">{currentAsk.label ?? 'Выберите'}: </span>
          {(currentAsk.options ?? []).map((option) => (
            <button
              key={option}
              className="cw-btn-3d btn-paper btn-sm"
              onClick={() => submitChoice({ kind: 'option', option })}
            >
              {OPTION_LABELS[option] ?? option}
            </button>
          ))}
        </span>
      );
    }
    if (currentAsk.kind === 'damage_distribution') {
      const addMode = currentAsk.mode === 'add';
      const creatures = me.zones.flatMap((z) => (z.creature ? [z.creature] : []));
      const total = creatures.reduce((sum, c) => sum + c.damage, 0);
      const values = creatures.map((c, i) => (distribution[i] === undefined ? (addMode ? '0' : String(c.damage)) : distribution[i]!));
      const numbers = values.map(Number);
      // reassign (перераспределение): сумма сохраняется, добивать нельзя;
      // add (распределение добавочного урона): сумму сверяет domain.
      const valid = addMode
        ? numbers.every((v) => Number.isInteger(v) && v >= 0)
        : numbers.every((v) => Number.isInteger(v) && v >= 0) &&
          numbers.reduce((a, b) => a + b, 0) === total &&
          numbers.every((v, i) => v < creatures[i]!.effDefense);
      const entered = numbers.reduce((a, b) => a + b, 0);
      return (
        <span className="revealed-pool">
          <span className="hint">
            {currentAsk.label ?? 'Распределите урон'}
            {addMode ? ` (введено ${entered})` : ` (всего ${total})`}:
          </span>
          {creatures.map((creature, i) => (
            <label key={creature.instanceId} className="hint">
              {cardNameById(creature.cardId)} (DEF {creature.effDefense}):{' '}
              <input
                type="number"
                min={0}
                max={addMode ? undefined : Math.max(0, creature.effDefense - 1)}
                value={values[i]}
                onChange={(e) => {
                  const next = [...values];
                  next[i] = e.target.value;
                  setDistribution(next);
                }}
                style={{ width: 52 }}
                aria-label={`Урон для ${cardNameById(creature.cardId)}`}
              />
            </label>
          ))}
          <button
            className="cw-btn-3d btn-green btn-sm"
            disabled={!valid}
            onClick={() => {
              submitChoice({ kind: 'amounts', values: numbers });
              setDistribution([]);
            }}
          >
            ОК
          </button>
        </span>
      );
    }
    return null;
  })();

  return (
    <div className="hud hud-viewport-overlay">
      {/* Tomato Splatter Screen Overlay */}
      {tomatoSplats.length > 0 && (
        <div className="cw-tomato-splat-layer" aria-hidden="true">
          {tomatoSplats.map((sp) => (
            <svg
              key={sp.id}
              className="cw-tomato-splat"
              viewBox="0 0 120 120"
              style={{
                left: `${sp.x}%`,
                top: `${sp.y}%`,
                transform: `translate(-50%, -50%) rotate(${sp.rot}deg) scale(${sp.scale})`,
              }}
            >
              <path
                d="M60 12 C69 22, 84 10, 92 26 C100 40, 114 38, 108 56 C103 72, 115 86, 98 96 C82 105, 75 116, 58 108 C42 100, 26 112, 20 94 C14 78, 4 70, 14 54 C24 38, 14 22, 32 18 C46 14, 52 4, 60 12 Z"
                fill="#d92626"
                fillOpacity="0.86"
                stroke="#7f1d1d"
                strokeWidth="3"
              />
              <circle cx="18" cy="24" r="5" fill="#e53e3e" fillOpacity="0.85" />
              <circle cx="102" cy="98" r="6" fill="#e53e3e" fillOpacity="0.85" />
              <circle cx="96" cy="22" r="4" fill="#dc2626" fillOpacity="0.85" />
              <ellipse cx="48" cy="46" rx="7" ry="4" fill="#fca5a5" fillOpacity="0.55" />
            </svg>
          ))}
        </div>
      )}

      {/* Active Tomato Mode Banner */}
      {tomatoMode && (
        <div className="pending-banner cw-felt-box cw-tomato-banner">
          <span>🍅 Режим помидора — нажмите на противника на столе:</span>
          <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
            {view.order
              .filter((pid) => pid !== view.me)
              .map((pid) => (
                <button
                  key={pid}
                  type="button"
                  className="cw-btn-3d btn-red btn-sm"
                  onClick={() => sendTomato(pid)}
                >
                  🍅 {view.players[pid]?.nickname ?? pid}
                </button>
              ))}
            <button type="button" className="cw-btn-3d btn-dark btn-sm" onClick={toggleTomatoMode}>
              ✕ Выйти
            </button>
          </span>
        </div>
      )}

      {/* Comic speech bubble for taunts / emotes */}
      {activeEmote && (
        <div className="hud-emote-bubble" role="status" aria-live="polite">
          <span className="hud-emote-emoji">{activeEmote.emoji || '💬'}</span>
          <div className="hud-emote-text-group">
            <span className="hud-emote-sender">{activeEmote.sender}</span>
            <span className="hud-emote-message">«{activeEmote.text}»</span>
          </div>
        </div>
      )}

      {error && <div className="error-line hud-error">{error.message}</div>}

      {/* Границы слова — данные героя (wordSetup, docs §H7); имён героев в клиенте нет. */}
      {view.status === 'running' && wordSetup && !view.myWord && (
        <div className="pending-banner cw-felt-box">
          <span>{wordSetup.label ?? `Выбери слово (от ${wordSetup.min} букв) для способности героя:`}</span>
          <input
            value={wordInput}
            maxLength={wordSetup.max}
            onChange={(e) => setWordInput(e.target.value)}
            aria-label="Слово героя"
          />
          <button
            className="cw-btn-3d btn-green btn-sm"
            disabled={wordInput.trim().length < wordSetup.min}
            onClick={() => {
              soundEngine.playCardSelect();
              sendCommand({ type: 'choose_word', player: view.me, word: wordInput.trim() });
            }}
          >
            ОК
          </button>
        </div>
      )}

      {targeting && targeting.mode === 'active' && (
        <div className="pending-banner cw-felt-box">
          <span>
            {targeting.label} — цель {targeting.askIndex + 1}/{targeting.asks.length}
          </span>
          {renderPlayerTargetButtons()}
          {nonBoardPicker}
          <button className="cw-btn-3d btn-dark btn-sm" onClick={() => setUi({ targeting: null })}>
            Отмена
          </button>
        </div>
      )}

      {view.pending && (
        <div className="pending-banner cw-felt-box">
          {pendingSourceInfo && (
            <div className="pending-ability-desc">
              <b>«{pendingSourceInfo.name}»</b>
              {pendingSourceInfo.text ? ` — ${pendingSourceInfo.text}` : ''}
            </div>
          )}
          <div className="pending-controls">
            {view.pending.player === view.me ? (
              <>
                <b>
                  {view.pending.kind === 'optional'
                    ? 'Применить способность?'
                    : `Выберите цель (${(view.pending.askIndex ?? 0) + 1}${view.pending.askCount ? `/${view.pending.askCount}` : ''}):`}
                </b>
                {view.pending.kind === 'optional' && (
                  <button
                    className="cw-btn-3d btn-green btn-sm"
                    onClick={() => sendCommand({ type: 'resolve_choice', player: view.me, answer: { proceed: true } })}
                  >
                    Да
                  </button>
                )}
                <button
                  className="cw-btn-3d btn-dark btn-sm"
                  onClick={() =>
                    sendCommand({
                      type: 'resolve_choice',
                      player: view.me,
                      answer: view.pending!.kind === 'optional' ? { proceed: false } : {},
                    })
                  }
                >
                  Пропустить
                </button>
                {renderPlayerTargetButtons()}
                {discardPickers}
                {nonBoardPicker}
                {(() => {
                  // «Восстанови или нанеси урон» — выбор режима.
                  const askKind = (() => {
                    if (view.pending?.kind === 'target' || view.pending?.kind === 'effect_step') {
                      const ability = view.pending.cardId
                        ? catalog.getCard(view.pending.cardId)?.abilities?.[view.pending.abilityIndex ?? 0]
                        : catalog.getHero(view.players[view.pending.player]!.heroId)?.ability;
                      return ability?.targets?.[view.pending.askIndex ?? 0]?.kind;
                    }
                    if (targeting) return targeting.asks[targeting.askIndex]?.kind;
                    return undefined;
                  })();
                  if (askKind !== 'heal_or_damage') return null;
                  return (
                    <>
                      <button
                        className="cw-btn-3d btn-green btn-sm"
                        onClick={() => targetingPick({ kind: 'mode', mode: 'heal' })}
                      >
                        Восстанови
                      </button>
                      <button
                        className="cw-btn-3d btn-dark btn-sm"
                        onClick={() => targetingPick({ kind: 'mode', mode: 'damage' })}
                      >
                        Нанеси урон
                      </button>
                    </>
                  );
                })()}
              </>
            ) : (
              <>Ожидается решение: {view.players[view.pending.player]?.nickname ?? view.pending.player}</>
            )}
          </div>
          {/* Приватное вскрытие (Рикардио, docs §H8): видит только владелец окна. */}
          {view.pending?.player === view.me && view.myPeek.length > 0 && (
            <span className="hint">
              Открытая карта: {view.myPeek.map((card) => cardNameById(card.cardId)).join(', ')}
            </span>
          )}
          {revealedForPendingPlayer.length > 0 && (
            <div className="revealed-picker" aria-label="Открытые карты">
              {revealedForPendingPlayer.map((card) =>
                view.pending?.player === view.me ? (
                  <button
                    key={card.instanceId}
                    className="revealed-card cw-btn-3d btn-paper btn-sm"
                    onClick={() =>
                      sendCommand({
                        type: 'resolve_choice',
                        player: view.me,
                        answer: { targets: [{ kind: 'card', instanceId: card.instanceId }] },
                      })
                    }
                  >
                    {cardNameById(card.cardId)}
                  </button>
                ) : (
                  <span key={card.instanceId} className="revealed-card spectator">
                    {cardNameById(card.cardId)}
                  </span>
                ),
              )}
            </div>
          )}
        </div>
      )}

      {view.status === 'finished' && (
        <MatchFinishOverlay view={view} code={code} />
      )}

      {unfreezePrompt && (
        <UnfreezeDialog
          prompt={unfreezePrompt}
          view={view}
          onClose={() => setUi({ unfreezePrompt: null })}
        />
      )}

      {/* Кнопка сворачивания/разворачивания руки */}
      {view.status === 'running' && view.myHand.length > 0 && (
        <div className={`hud-hand-control-overlay ${handCollapsed ? 'is-collapsed' : ''}`}>
          <button
            className={`hud-hand-toggle-btn cw-btn-3d btn-paper btn-sm ${handCollapsed ? 'collapsed' : ''}`}
            onClick={() => {
              soundEngine.playButtonClick();
              toggleHandCollapsed();
            }}
            title="Скрыть/показать карты руки (H)"
          >
            <span className="btn-icon">{handCollapsed ? '▲' : '▼'}</span>
            <span className="btn-text">{handCollapsed ? `Рука (${view.myHand.length})` : 'Свернуть руку'}</span>
          </button>
        </div>
      )}

      <OrientationGate />
      <CardZoomModal />
    </div>
  );
}

function UnfreezeDialog({
  prompt,
  view,
  onClose,
}: {
  prompt: { instanceId: string; zone: number };
  view: PlayerView;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pointerDownOutsideRef = useRef(false);

  const playedCard = view.myHand.find((c) => c.instanceId === prompt.instanceId);
  const playedMeta = playedCard ? catalog.getCard(playedCard.cardId) : undefined;
  const otherCards = view.myHand.filter((c) => c.instanceId !== prompt.instanceId);

  useEffect(() => {
    const el = dialogRef.current;
    if (el && !el.open) {
      soundEngine.playModalOpen();
      el.showModal();
    }
  }, []);

  const isOutsideDialog = (e: React.PointerEvent<HTMLDialogElement>) => {
    const el = dialogRef.current;
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    );
  };

  return (
    <dialog
      ref={dialogRef}
      className="cw-dialog cw-felt-box unfreeze-dialog"
      aria-labelledby="unfreeze-title"
      onClose={onClose}
      onPointerDown={(e) => {
        pointerDownOutsideRef.current = e.target === dialogRef.current && isOutsideDialog(e);
      }}
      onPointerUp={(e) => {
        if (pointerDownOutsideRef.current && e.target === dialogRef.current && isOutsideDialog(e)) {
          onClose();
        }
        pointerDownOutsideRef.current = false;
      }}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="cw-dialog__head">
        <h2 id="unfreeze-title" className="cw-ink-title">
          ❄ Разморозка земли
        </h2>
        <button
          type="button"
          className="cw-dialog__close cw-btn-3d btn-dark btn-sm"
          onClick={onClose}
          aria-label="Закрыть"
        >
          ✕
        </button>
      </div>
      <p className="hint">
        Земля в <b>зоне {prompt.zone + 1}</b> заморожена. Чтобы разыграть{' '}
        <b>«{playedMeta?.name ?? 'карту'}»</b>, выберите карту из руки для сброса:
      </p>
      <div className="unfreeze-card-list">
        {otherCards.map((card) => {
          const meta = catalog.getCard(card.cardId);
          return (
            <button
              key={card.instanceId}
              className="unfreeze-card-btn cw-btn-3d btn-paper btn-sm btn-block"
              onClick={() => {
                soundEngine.playCardDiscard();
                sendCommand({
                  type: 'play_card',
                  player: view.me,
                  instanceId: prompt.instanceId,
                  zone: prompt.zone,
                  unfreezeWith: card.instanceId,
                });
                onClose();
              }}
            >
              <div className="unfreeze-card-title">{meta?.name ?? card.cardId}</div>
              <div className="unfreeze-card-meta">
                {meta?.type === 'creature' ? 'Существо' : meta?.type === 'building' ? 'Строение' : 'Карта'} · Стоимость: {meta?.cost ?? 0}
              </div>
            </button>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button type="button" className="cw-btn-3d btn-dark btn-sm" onClick={onClose}>
          Отмена
        </button>
      </div>
    </dialog>
  );
}

/** RU labels for named branches declared in mechanics data (docs §H1). */
const OPTION_LABELS: Record<string, string> = {
  corn: 'Кукуруза',
  blue: 'Голубая равнина',
  good: 'Добрая земля',
  ice: 'Лёд',
  sand: 'Песок',
  swamp: 'Болото',
  rainbow: 'Радуга',
  lava: 'Лавовая',
  all: 'Все существа',
  one: 'Одно существо',
  heal: 'Восстановить',
  damage: 'Нанести урон',
  deck_top: 'На верх колоды',
  hand: 'В руку',
  keep: 'Оставить',
  discard: 'Сбросить',
};
