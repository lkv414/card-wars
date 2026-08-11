import { useState } from 'react'
import { Replay } from './Replay'
import { safePlayer } from '../../utils/safePlayer'
import { HUDTopBar } from './hud/HUDTopBar'
import { HUDConnectionBanners } from './hud/HUDConnectionBanners'
import { HUDBottomBar } from './hud/HUDBottomBar'
import { HUDDropZones } from './hud/HUDDropZones'
import { HUDHand } from './hud/HUDHand'

export function HUDOverlay({
  playerId,
  isYourTurn,
  isFinished,
  winnerId,
  me,
  opp,
  handCards,
  log,
  onEndTurn,
  onForfeit,
  onGameEnd,
  realtimeStatus,
  selectedCardIndex = null,
  setSelectedCardIndex = () => {},
  isApplying = false,
  actionError = null,
  onPlayCard = null,
}) {
  const [draggingCardIndex, setDraggingCardIndex] = useState(null)
  const [justPlayedCardIndex, setJustPlayedCardIndex] = useState(null)
  const [justPlayedZoneIndex, setJustPlayedZoneIndex] = useState(null)
  const [isReplayOpen, setReplayOpen] = useState(false)

  const safeMe = safePlayer([me].filter(Boolean), me?.player_id)
  const safeOpp = safePlayer([opp].filter(Boolean), opp?.player_id)

  const handleJustPlayed = (cardIndex, zoneIndex) => {
    setJustPlayedCardIndex(cardIndex)
    setJustPlayedZoneIndex(zoneIndex)
    setTimeout(() => {
      setJustPlayedCardIndex(null)
      setJustPlayedZoneIndex(null)
    }, 1800)
  }

  return (
    <>
      <HUDTopBar
        onGameEnd={onGameEnd}
        logLength={Array.isArray(log) ? log.length : 0}
        onOpenReplay={() => setReplayOpen(true)}
        opponent={safeOpp}
      />

      {isReplayOpen && <Replay log={log} onClose={() => setReplayOpen(false)} />}

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
          isApplying={isApplying}
          onEndTurn={onEndTurn}
          onForfeit={onForfeit}
        />

        {isYourTurn && !isFinished && draggingCardIndex !== null && (
          <HUDDropZones
            me={me}
            draggingCardIndex={draggingCardIndex}
            isApplying={isApplying}
            onPlayCard={onPlayCard}
            onDragEnd={() => setDraggingCardIndex(null)}
            onJustPlayed={handleJustPlayed}
          />
        )}

        <HUDHand
          handCards={handCards}
          isYourTurn={isYourTurn}
          isFinished={isFinished}
          isApplying={isApplying}
          selectedCardIndex={selectedCardIndex}
          setSelectedCardIndex={setSelectedCardIndex}
          draggingCardIndex={draggingCardIndex}
          setDraggingCardIndex={setDraggingCardIndex}
          justPlayedCardIndex={justPlayedCardIndex}
          onPlayCard={onPlayCard}
        />
      </div>

      {justPlayedCardIndex !== null && justPlayedZoneIndex !== null && (
        <div className="hud-just-played-toast" role="status" aria-live="polite">
          ✅ Карта #{justPlayedCardIndex + 1} выложена на землю {justPlayedZoneIndex + 1}
        </div>
      )}
    </>
  )
}
