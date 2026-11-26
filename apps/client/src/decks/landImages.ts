import { PLAYABLE_LAND_TYPES, getLand, lands, type LandData, type LandType } from '@card-wars/content';

export { PLAYABLE_LAND_TYPES };

export const LAND_META: Record<LandType, { label: string; shortLabel: string }> = {
  corn: { label: 'Кукурузные поля', shortLabel: 'Кукуруза' },
  blue: { label: 'Синие равнины', shortLabel: 'Синие' },
  good: { label: 'Милые земли', shortLabel: 'Милые' },
  ice: { label: 'Ледяные земли', shortLabel: 'Лёд' },
  sand: { label: 'Песчаные земли', shortLabel: 'Песок' },
  swamp: { label: 'Болото', shortLabel: 'Болото' },
  rainbow: { label: 'Радужная земля', shortLabel: 'Радуга' },
  lava: { label: 'Лавовые земли', shortLabel: 'Лава' },
};

const LANDS_BY_TYPE: Record<Exclude<LandType, 'rainbow'>, LandData[]> = {
  corn: [],
  blue: [],
  good: [],
  ice: [],
  sand: [],
  swamp: [],
  lava: [],
};

for (const land of lands) {
  LANDS_BY_TYPE[land.landType].push(land);
}

const LAND_IMAGES: Record<LandType, string[]> = {
  corn: LANDS_BY_TYPE.corn.map((l) => l.image),
  blue: LANDS_BY_TYPE.blue.map((l) => l.image),
  good: LANDS_BY_TYPE.good.map((l) => l.image),
  ice: LANDS_BY_TYPE.ice.map((l) => l.image),
  sand: LANDS_BY_TYPE.sand.map((l) => l.image),
  swamp: LANDS_BY_TYPE.swamp.map((l) => l.image),
  lava: LANDS_BY_TYPE.lava.map((l) => l.image),
  rainbow: ['/content/other/card-back-6cefc0e.webp'],
};

export function getLandArts(type: LandType): LandData[] {
  if (type === 'rainbow') return [];
  return LANDS_BY_TYPE[type] ?? [];
}

export function resolveLandImageUrl(
  type: LandType,
  artId?: string | null,
  variantIndex = 1,
): string | null {
  if (artId) {
    const found = getLand(artId);
    if (found && found.landType === type) {
      return found.image;
    }
  }
  const arts = getLandArts(type);
  if (arts.length > 0) {
    const idx = Math.max(0, variantIndex - 1) % arts.length;
    return arts[idx]?.image ?? null;
  }
  const images = LAND_IMAGES[type];
  if (!images || images.length === 0) return null;
  const idx = Math.max(0, variantIndex - 1) % images.length;
  return images[idx] ?? null;
}

export function landImageUrl(type: LandType, variant = 1): string | null {
  return resolveLandImageUrl(type, null, variant);
}

export const PRIMARY_LAND_IMAGES: string[] = PLAYABLE_LAND_TYPES
  .map((type) => LANDS_BY_TYPE[type][0]?.image)
  .filter((url): url is string => Boolean(url));
