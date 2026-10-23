/**
 * ZoneColumn — одна зона (земля + до 2 карт) на 3D-поле.
 *
 * Извлечено из GameBoard3D, чтобы:
 *   1) memo работал: колонки получают стабильные пропсы (zoneIndex, landType,
 *      dropState, refs на колбэки), и при изменении только одной зоны —
 *      ре-рендерятся только она.
 *   2) GameBoard3D не видел внутренности карт и земель, не пересоздавал на каждый
 *      рендер массивы/объекты в JSX.
 *
 * Все позиции/повороты — модульные константы (см. sceneResources.js).
 */
import { memo, useCallback } from 'react'

import { GameLand } from '../scene/GameLand'
import { GameObject } from '../scene/GameObject'

import { CARD_OBJECT_TYPES } from '../../../utils/gameObjectPlacement'
import { makeCardKey } from '../../../utils/cardKey'
import {
  CARD_ROT_FLAT,
  CARD_LAYER_Y,
  LAND_SLOT_LAYOUT,
} from '../../../utils/sceneResources'
import {
  PLAY_FIELD_Y,
} from '../../../utils/gameObjectPlacement'
import { resolveCardVisual } from '../../../utils/resolveCardVisual'

export const ZoneColumn = memo(function ZoneColumn({
  zone,
  creatureCard: rawCreature,
  buildingCard: rawBuilding,
  isSelectedZone,
  dropState,
  cardCatalog,
  isYourTurn,
  creaturePlayable,
  buildingPlayable,
  damageFlashKeys = [],
  tableScale,
  onLandClick,
  isAttackTarget = false,
  onZoneAttackClick,
  onCreatureSlotClick,
  onBuildingSlotClick,
  onCreatureCardClick,
  onBuildingCardClick,
  passiveMarkerKey,
  hasPassiveDamage = false,
}) {
  const creatureCard = rawCreature ? resolveCardVisual(rawCreature, cardCatalog) : null
  const buildingCard = rawBuilding ? resolveCardVisual(rawBuilding, cardCatalog) : null
  const landType = zone.landType

  const handleLandClick = useCallback(() => {
    onLandClick?.(zone)
  }, [onLandClick, zone])

  const handleZoneAttack = useCallback(() => {
    onZoneAttackClick?.(zone)
  }, [onZoneAttackClick, zone])

  const handleCreatureSlot = useCallback(() => {
    onCreatureSlotClick?.(zone)
  }, [onCreatureSlotClick, zone])

  const handleBuildingSlot = useCallback(() => {
    onBuildingSlotClick?.(zone)
  }, [onBuildingSlotClick, zone])

  const cardLayerY = PLAY_FIELD_Y + CARD_LAYER_Y
  const zoneKey = `${zone.player.player_id}-${zone.zoneIndex}`
  const creatureDamage = damageFlashKeys.includes(`${zoneKey}-creature`)
  const buildingDamage = damageFlashKeys.includes(`${zoneKey}-building`)

  return (
    <group
      position={zone.center}
      rotation={[0, zone.rotationY, 0]}
    >
      <GameLand
        landType={landType}
        selected={isSelectedZone}
        dropState={dropState}
        zoneIndex={zone.zoneIndex}
        onClick={handleLandClick}
        isAttackTarget={isAttackTarget}
        onZoneAttackClick={handleZoneAttack}
        creaturePlayable={creaturePlayable}
        buildingPlayable={buildingPlayable}
        onCreatureClick={handleCreatureSlot}
        onBuildingClick={handleBuildingSlot}
      />

      {creatureCard && (
        <GameObject
          key={makeCardKey(creatureCard, { slot: 'creature', zoneIndex: zone.zoneIndex })}
          card={creatureCard}
          type={CARD_OBJECT_TYPES.CREATURE}
          position={[
            LAND_SLOT_LAYOUT.creature.x,
            cardLayerY,
            LAND_SLOT_LAYOUT.creature.z,
          ]}
          rotation={CARD_ROT_FLAT}
          flatOnTable
          tableScale={tableScale}
          isSelected={isSelectedZone}
          isFaceUp
          showStats
          damageFlash={creatureDamage}
          passiveDamage={hasPassiveDamage}
          showFlipOption={Boolean(zone.isOwnerMe && isYourTurn)}
          onClick={() => onCreatureCardClick?.(zone, creatureCard)}
        />
      )}

      {buildingCard && (
        <GameObject
          key={makeCardKey(buildingCard, { slot: 'building', zoneIndex: zone.zoneIndex })}
          card={buildingCard}
          type={CARD_OBJECT_TYPES.BUILDING}
          position={[
            LAND_SLOT_LAYOUT.building.x,
            cardLayerY,
            LAND_SLOT_LAYOUT.building.z,
          ]}
          rotation={CARD_ROT_FLAT}
          flatOnTable
          tableScale={tableScale}
          isSelected={false}
          isFaceUp
          showStats
          damageFlash={buildingDamage}
          onClick={() => onBuildingCardClick?.(zone, buildingCard)}
        />
      )}
    </group>
  )
})

ZoneColumn.displayName = 'ZoneColumn'