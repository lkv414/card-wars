import { heroes } from '@card-wars/content';

export function heroNameOf(heroId: string): string {
  return heroes.find((h) => h.id === heroId)?.name ?? heroId;
}
