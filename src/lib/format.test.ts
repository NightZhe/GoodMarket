import { describe, expect, it } from 'vitest';
import { cheapestVariant } from './format';

describe('cheapestVariant', () => {
  it('空陣列回 undefined，不丟例外', () => {
    expect(cheapestVariant([])).toBeUndefined();
  });
  it('回最低價的規格', () => {
    expect(cheapestVariant([{ price: 30 }, { price: 10 }, { price: 20 }])).toEqual({ price: 10 });
  });
});
