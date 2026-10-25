import { describe, expect, it } from 'vitest';
import * as domain from './index';

describe('domain skeleton', () => {
  it('импортируется без ошибок', () => {
    expect(domain).toBeDefined();
  });
});
