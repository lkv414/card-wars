import { useMemo, useState } from 'react'
import { Replay } from './Replay'
import { safePlayer } from '../../utils/safePlayer'
import { HUDTopBar } from './hud/HUDTopBar'
import { HUDOpponents } from './hud/HUDOpponents'
import { HUDConnectionBanners } from './hud/HUDConnectionBanners'
import { HUDBottomBar } from './hud/HUDBottomBar'
import { HUDHand } from './hud/HUDHand'
import { CardActionMenu } from './hud/CardActionMenu'
import { ZoneCardActionMenu } from './hud/ZoneCardActionMenu'
import { CardPreviewModal } from './hud/CardPreviewModal'
import { PlayerSideIndicator } from './hud/PlayerSideIndicator'
import { mergeLogWithBattle } from '../../hooks/game/battleLog'

export function HUDOverlay({
  playerId,
  isYourTurn,
  isFinished,
  winnerId,
  me,
  players = [],
  handCards,
  actionsRemaining = 2,
  canDealDamage = true,
  log,
  battleEvents = [],
  onEndTurn,
  onForfeit,
  onDrawFreeCard,
  onDrawPaidCard,
  onShuffleDeck,
  onDiscardFromHand,
  onGameEnd,
  realtimeStatus,
  playerCount = 2,
  myIndex = 0,
  selectedCardIndex = null,
  setSelectedCardIndex = () => {},
  isApplying = false,
  actionError = null,
  draggingCardIndex = null,
  setDraggingCardIndex = () => {},
  updatePointer,
  cardActionMenu = null,
  zoneCardActionMenu = null,
  onCloseCardActionMenu = () => {},
  onCloseZoneCardActionMenu = () => {},
}) {
  const [isReplayOpen, setReplayOpen] = useState(false)
  const [previewCard, setPreviewCard] = useState(null)

  const safeMe = safePlayer([me].filter(Boolean), me?.player_id)
  const replayLog = useMemo(() => mergeLogWithBattle(log, battleEvents), [log, battleEvents])

  return (
    <>
      <HUDTopBar
        onGameEnd={onGameEnd}
        logLength={replayLog.length}
        onOpenReplay={() => setReplayOpen(true)}
      />

      <HUDOpponents players={players} myPlayerId={playerId} />

      <PlayerSideIndicator playerCount={playerCount} myIndex={myIndex} />

      {previewCard && (
        <CardPreviewModal card={previewCard} onClose={() => setPreviewCard(null)} />
      )}

      {isReplayOpen && <Replay log={replayLog} onClose={() => setReplayOpen(false)} />}

      {cardActionMenu && (
        <CardActionMenu
          card={cardActionMenu.card}
          onAttack={cardActionMenu.onAttack}
          onFlip={cardActionMenu.onFlip}
          onClose={onCloseCardActionMenu}
        />
      )}

      {zoneCardActionMenu && (
        <ZoneCardActionMenu
          card={zoneCardActionMenu.card}
          onFlip={zoneCardActionMenu.onFlip}
          onDiscard={zoneCardActionMenu.onDiscard}
          onClose={onCloseZoneCardActionMenu}
        />
      )}

      <HUDConnectionBanners
        realtimeStatus={realtimeStatus}
        actionError={actionError}
        isApplying={isApplying}
      />

      <div className="hud-bottom">
        <HUDBottomBar
          isYourTurn={isYourTurn}
          isFinished={isFinished}
          winnerId={winnerId}
          playerId={playerId}
          me={safeMe}
          actionsRemaining={actionsRemaining}
          canDealDamage={canDealDamage}
          isApplying={isApplying}
          freeDrawUsed={Boolean(safeMe.free_draw_used)}
          paidDrawUsed={Boolean(safeMe.paid_draw_used)}
          onEndTurn={onEndTurn}
          onForfeit={onForfeit}
          onDrawFreeCard={onDrawFreeCard}
          onDrawPaidCard={onDrawPaidCard}
          onShuffleDeck={onShuffleDeck}
        />

        <HUDHand
          handCards={handCards}
          isYourTurn={isYourTurn}
          isFinished={isFinished}
          isApplying={isApplying}
          selectedCardIndex={selectedCardIndex}
          setSelectedCardIndex={setSelectedCardIndex}
          draggingCardIndex={draggingCardIndex}
          setDraggingCardIndex={setDraggingCardIndex}
          updatePointer={updatePointer}
          onPreviewCard={setPreviewCard}
          onDiscardToTrash={onDiscardFromHand}
        />
      </div>
    </>
  )
}
