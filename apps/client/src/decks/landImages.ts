import type { LandType } from '@card-wars/content';

export const LAND_META: Record<LandType, { label: string; shortLabel: string }> = {
  corn: { label: 'Кукурузные поля', shortLabel: 'Кукуруза' },
  blue: { label: 'Синие равнины', shortLabel: 'Синие' },
  good: { label: 'Милые земли', shortLabel: 'Милые' },
  ice: { label: 'Ледяные земли', shortLabel: 'Лёд' },
  sand: { label: 'Песчаные земли', shortLabel: 'Песок' },
  swamp: { label: 'Болото', shortLabel: 'Болото' },
  rainbow: { label: 'Радужная земля', shortLabel: 'Радуга' },
  ghost: { label: 'Призрачные земли', shortLabel: 'Призраки' },
};

const LAND_IMAGES: Record<LandType, string[]> = {
  blue: [
    '/content/lands/blue-plains-0b69d6a.webp',
    '/content/lands/blue-plains-3492f70.webp',
    '/content/lands/blue-plains-46a7379.webp',
    '/content/lands/blue-plains-7dac25a.webp',
  ],
  corn: [
    '/content/lands/cornfield-64b3840.webp',
    '/content/lands/cornfield-6bb9987.webp',
    '/content/lands/cornfield-99f5fe6.webp',
    '/content/lands/cornfield-ad120b3.webp',
  ],
  ice: [
    '/content/lands/icy-lands-35b4c74.webp',
    '/content/lands/icy-lands-780036a.webp',
    '/content/lands/icy-lands-9bfc69c.webp',
    '/content/lands/icy-lands-afb5844.webp',
  ],
  ghost: [
    '/content/lands/lava-lands-1b34cd3.webp',
    '/content/lands/lava-lands-374062d.webp',
    '/content/lands/lava-lands-96d0405.webp',
    '/content/lands/lava-lands-b0e4784.webp',
  ],
  good: [
    '/content/lands/nice-lands-1ea01c4.webp',
    '/content/lands/nice-lands-4e666d5.webp',
    '/content/lands/nice-lands-8c6e217.webp',
    '/content/lands/nice-lands-ab94559.webp',
  ],
  sand: [
    '/content/lands/sandy-lands-1a7e5ef.webp',
    '/content/lands/sandy-lands-1eb2378.webp',
    '/content/lands/sandy-lands-448f335.webp',
    '/content/lands/sandy-lands-56bc7c3.webp',
  ],
  swamp: [
    '/content/lands/useless-swamps-2918fd8.webp',
    '/content/lands/useless-swamps-2c1516f.webp',
    '/content/lands/useless-swamps-40eac4b.webp',
    '/content/lands/useless-swamps-8ea1ff2.webp',
  ],
  rainbow: [
    '/content/other/card-back-6cefc0e.webp',
  ],
};

export function landImageUrl(type: LandType, variant = 1): string | null {
  const images = LAND_IMAGES[type];
  if (!images || images.length === 0) return null;
  const idx = Math.max(0, variant - 1) % images.length;
  return images[idx] ?? null;
}
