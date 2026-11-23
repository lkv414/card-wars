import { heroes } from '@card-wars/content';

export function heroNameOf(heroId: string): string {
  return heroes.find((h) => h.id === heroId)?.name ?? heroId;
}

export function heroImageOf(heroId: string): string | undefined {
  return heroes.find((h) => h.id === heroId)?.image;
}
